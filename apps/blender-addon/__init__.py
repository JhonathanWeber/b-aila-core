import bpy
import requests
import json
import webbrowser
import subprocess
import os

bl_info = {
    "name": "B-AILA (Blender AI Local Assistant)",
    "author": "JhonDev",
    "version": (0, 1),
    "blender": (3, 3, 0),
    "location": "View3D > Sidebar > JhonDev IA",
    "description": "Local-first AI assistant for Blender modeling automation.",
    "category": "Interface",
}

# --- Properties ---
class BAILA_Properties(bpy.types.PropertyGroup):
    user_prompt: bpy.props.StringProperty(
        name="Prompt",
        description="Type your command or question for the AI",
        default=""
    )
    ai_response: bpy.props.StringProperty(
        name="AI Response",
        description="The latest response from the AI",
        default="Waiting for your prompt..."
    )
    auto_run: bpy.props.BoolProperty(
        name="Auto-Run Code",
        description="Automatically execute generated Python code",
        default=True
    )
    api_url: bpy.props.StringProperty(
        name="API URL",
        default="http://localhost:8990"
    )

# --- UI Panel ---
class VIEW3D_PT_baila_panel(bpy.types.Panel):
    bl_label = "B-AILA Chat"
    bl_idname = "VIEW3D_PT_baila_panel"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'JhonDev IA'

    def draw(self, context):
        layout = self.layout
        props = context.scene.baila_props

        # Chat History
        col = layout.column(align=True)
        col.label(text="Chat History:")
        box = col.box()
        
        # Split text into multiple lines if it's too long (simple wrap)
        lines = props.ai_response.split('\n')
        for line in lines:
            if line.strip():
                box.label(text=line)

        # Open Chat Window
        row = layout.row()
        row.operator("baila.open_chat", text="Open Chat", icon='WINDOW')

        layout.separator()

        # Chat History (last response preview)
        col = layout.column(align=True)
        box = col.box()
        lines = props.ai_response.split('\n')
        for line in lines[:8]:  # show up to 8 lines
            if line.strip():
                box.label(text=line[:60])  # truncate long lines

        # User Input
        layout.separator()
        layout.prop(props, "user_prompt")
        
        # Action Buttons
        row = layout.row()
        row.operator("baila.send_prompt", text="Send", icon='PLAY')
        
        # Settings
        layout.separator()
        layout.prop(props, "auto_run")

import threading
import time

# --- Operators ---
class BAILA_OT_send_prompt(bpy.types.Operator):
    bl_idname = "baila.send_prompt"
    bl_label = "Send Prompt"
    
    _job_id = None
    _status = "idle"
    _result_chat = ""
    _result_code = ""

    def execute(self, context):
        props = context.scene.baila_props
        prompt = props.user_prompt
        
        if not prompt:
            self.report({'WARNING'}, "Prompt cannot be empty!")
            return {'CANCELLED'}
        
        # Capture Scene Snaphot
        snapshot = self.get_scene_snapshot()
        
        try:
            payload = {"prompt": prompt, "context": snapshot}
            response = requests.post(f"{props.api_url}/ai/generate", json=payload, timeout=5)
            data = response.json()
            BAILA_OT_send_prompt._job_id = data.get("job_id")
            
            if BAILA_OT_send_prompt._job_id:
                print(f"B-AILA: Prompt sent! Job ID: {BAILA_OT_send_prompt._job_id}")
                props.ai_response = "AI: Thinking..."
                
                # Start Polling Background Thread
                BAILA_OT_send_prompt._status = "running"
                thread = threading.Thread(target=self.poll_job_thread, args=(props.api_url, BAILA_OT_send_prompt._job_id))
                thread.daemon = True
                thread.start()
                
                # Register UI Sync Timer (runs purely in main thread to safely update UI)
                bpy.app.timers.register(self.sync_ui_state, first_interval=1.0)
            
        except Exception as e:
            print(f"B-AILA Failed to connect: {str(e)}")
            props.ai_response = "AI: Backend offline."
            
        return {'FINISHED'}

    def poll_job_thread(self, api_url, job_id):
        """Runs in background to fetch HTTP status without blocking or relying on Blender context."""
        while BAILA_OT_send_prompt._status == "running":
            time.sleep(1)
            try:
                response = requests.get(f"{api_url}/ai/status/{job_id}", timeout=2)
                data = response.json()
                status = data.get("status")

                if status == "completed":
                    BAILA_OT_send_prompt._result_chat = data.get("data", {}).get("chat_message", "")
                    BAILA_OT_send_prompt._result_code = data.get("data", {}).get("python_code", "")
                    BAILA_OT_send_prompt._status = "completed"
                    print(f"B-AILA: Job done. Response: {BAILA_OT_send_prompt._result_chat}")
                    break
                elif status == "failed":
                    BAILA_OT_send_prompt._status = "failed"
                    break
            except Exception as e:
                print(f"B-AILA Polling error: {e}")

    @classmethod
    def sync_ui_state(cls):
        """Runs safely in the main Blender thread to apply the thread's results to UI."""
        status = BAILA_OT_send_prompt._status
        if status == "running":
            return 1.0 # keep checking
        
        # Thread finished doing its HTTP work
        scene = bpy.data.scenes[0]
        props = scene.baila_props
        
        if status == "completed":
            chat = BAILA_OT_send_prompt._result_chat
            code = BAILA_OT_send_prompt._result_code
            
            if chat:
                props.ai_response = f"AI: {chat}"
            elif code:
                props.ai_response = "AI: Code generated."
                
            if code and props.auto_run:
                cls.execute_ai_code(code)
                
        elif status == "failed":
            props.ai_response = "AI: Generation failed."
            
        # Refresh UI globally
        for screens in bpy.data.screens:
            for area in screens.areas:
                if area.type == 'VIEW_3D':
                    area.tag_redraw()
                    
        return None # stop syncing

    @classmethod
    def execute_ai_code(cls, code):
        """Executes Python code with error reporting."""
        try:
            # Code generated by web chat executes in a background timer with limited context.
            # We must override the context to a 3D View so geometry operators work correctly.
            override_context = None
            if bpy.context.window_manager:
                for window in bpy.context.window_manager.windows:
                    for area in window.screen.areas:
                        if area.type == 'VIEW_3D':
                            for region in area.regions:
                                if region.type == 'WINDOW':
                                    override_context = {'window': window, 'screen': window.screen, 'area': area, 'region': region, 'scene': bpy.context.scene}
                                    break
                            if override_context: break
                    if override_context: break

            exec_globals = {"bpy": bpy, "context": bpy.context}
            
            if override_context and hasattr(bpy.context, "temp_override"):
                with bpy.context.temp_override(**override_context):
                    exec(code, exec_globals)
            else:
                exec(code, exec_globals)
                
            print("B-AILA: Code executed successfully.")
            # TODO: Report success to backend
        except Exception as e:
            error_msg = str(e)
            print(f"B-AILA Python Error: {error_msg}")
            cls.report_error_to_backend(error_msg, code)

    @classmethod
    def report_error_to_backend(cls, error, code):
        """Reports a execution error back to the backend for self-healing."""
        props = bpy.context.scene.baila_props
        try:
            payload = {
                "job_id": cls._job_id,
                "error": error,
                "failed_code": code
            }
            requests.post(f"{props.api_url}/ai/report-error", json=payload, timeout=2)
        except:
            pass

    def get_scene_snapshot(self):
        """Extracts simple metadata from the scene for AI context."""
        objects = []
        for obj in bpy.context.selected_objects:
            objects.append({
                "name": obj.name,
                "type": obj.type,
                "location": list(obj.location)
            })
            
        return {
            "mode": bpy.context.mode,
            "active_object": bpy.context.active_object.name if bpy.context.active_object else None,
            "selected_objects": objects,
            "unit_system": bpy.context.scene.unit_settings.system
        }

# --- Open Chat Window Operator ---
class BAILA_OT_open_chat(bpy.types.Operator):
    bl_idname = "baila.open_chat"
    bl_label = "Open Chat"
    bl_description = "Open B-AILA Chat in a browser window"

    def execute(self, context):
        props = context.scene.baila_props
        chat_url = f"{props.api_url}/chat"
        
        # Try Chrome or Edge in --app mode for floating window experience
        chrome_paths = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        ]
        
        opened = False
        for chrome_exe in chrome_paths:
            if os.path.exists(chrome_exe):
                try:
                    subprocess.Popen([
                        chrome_exe,
                        f"--app={chat_url}",
                        "--window-size=420,700",
                        "--window-position=0,0"
                    ])
                    opened = True
                    break
                except Exception:
                    pass
        
        if not opened:
            # Fallback to default browser
            webbrowser.open(chat_url)
        
        return {'FINISHED'}

# --- Background Poller for Web Chat Execution ---
def poll_pending_code():
    """Polls the backend for code generated via the Web Chat and executes it."""
    try:
        if not bpy.context or not bpy.context.scene:
            return 1.0
            
        props = bpy.context.scene.baila_props
        if not props.auto_run:
            return 1.0  # skip if auto-run is disabled
            
        response = requests.get(f"{props.api_url}/api/blender/pending-code", timeout=1)
        if response.status_code == 200:
            data = response.json()
            pending = data.get("pending", [])
            for item in pending:
                code_id = item.get("id")
                code_str = item.get("code")
                
                if code_str:
                    print(f"B-AILA: Executing code from Web Chat (Job {code_id})")
                    BAILA_OT_send_prompt.execute_ai_code(code_str)
                    
                    # Mark as executed so we don't run it again
                    requests.post(
                        f"{props.api_url}/api/blender/mark-executed", 
                        json={"id": code_id}, 
                        timeout=1
                    )
    except Exception:
        pass # Ignore connection refused when backend is offline
        
    return 1.0 # Run again in 1 second

# --- Registration ---
classes = (
    BAILA_Properties,
    VIEW3D_PT_baila_panel,
    BAILA_OT_send_prompt,
    BAILA_OT_open_chat,
)

def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.Scene.baila_props = bpy.props.PointerProperty(type=BAILA_Properties)
    
    # Start the polling daemon
    if not bpy.app.timers.is_registered(poll_pending_code):
        bpy.app.timers.register(poll_pending_code)

def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
    del bpy.types.Scene.baila_props
    
    # Stop the polling daemon
    if bpy.app.timers.is_registered(poll_pending_code):
        bpy.app.timers.unregister(poll_pending_code)

if __name__ == "__main__":
    register()
