import bpy
import requests
import json

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

        # User Input
        layout.separator()
        layout.prop(props, "user_prompt")
        
        # Action Buttons
        row = layout.row()
        row.operator("baila.send_prompt", text="Send to AI", icon='CONSOLE')
        
        # Settings
        layout.separator()
        layout.prop(props, "auto_run")

# --- Operators ---
class BAILA_OT_send_prompt(bpy.types.Operator):
    bl_idname = "baila.send_prompt"
    bl_label = "Send Prompt"
    
    _timer = None
    _job_id = None

    def execute(self, context):
        props = context.scene.baila_props
        prompt = props.user_prompt
        
        if not prompt:
            self.report({'WARNING'}, "Prompt cannot be empty!")
            return {'CANCELLED'}
        
        # 1. Capture Scene Snaphot
        snapshot = self.get_scene_snapshot()
        
        # 2. Trigger Backend Handshake
        try:
            payload = {
                "prompt": prompt,
                "context": snapshot
            }
            response = requests.post(f"{props.api_url}/ai/generate", json=payload, timeout=5)
            data = response.json()
            self._job_id = data.get("job_id")
            
            if self._job_id:
                self.report({'INFO'}, f"Prompt sent! Job ID: {self._job_id}")
                # 3. Start Polling Timer
                bpy.app.timers.register(self.poll_job_status, first_interval=1.0)
            
        except Exception as e:
            self.report({'ERROR'}, f"Failed to connect to backend: {str(e)}")
            
        return {'FINISHED'}

    def poll_job_status(self):
        """Timer callback to check job status."""
        # Note: In timer, context is limited, get props directly from scene
        props = bpy.context.scene.baila_props
        try:
            response = requests.get(f"{props.api_url}/ai/status/{self._job_id}", timeout=2)
            data = response.json()
            status = data.get("status")

            if status == "completed":
                self.report({'INFO'}, "AI Response Received!")
                
                chat_msg = data.get("data", {}).get("chat_message", "")
                python_code = data.get("data", {}).get("python_code", "")
                
                if chat_msg:
                    props.ai_response = f"AI: {chat_msg}"
                elif python_code:
                    props.ai_response = "AI: Generated Python code successfully."
                    
                # Force UI to redraw safely from timer thread
                for screens in bpy.data.screens:
                    for area in screens.areas:
                        if area.type == 'VIEW_3D':
                            area.tag_redraw()

                print(f"AI: {chat_msg}")

                if python_code and props.auto_run:
                    self.execute_ai_code(python_code)
                
                return None # Stops the timer
            elif status == "failed":
                self.report({'ERROR'}, "AI Generation Failed.")
                return None # Stops the timer
            
        except Exception as e:
            print(f"Polling error: {e}")
            
        return 1.0 # Run again in 1 second

    def execute_ai_code(self, code):
        """Executes Python code with error reporting."""
        try:
            # Create a localized namespace for execution
            exec_globals = {"bpy": bpy, "context": bpy.context}
            exec(code, exec_globals)
            self.report({'INFO'}, "Code executed successfully.")
            # TODO: Report success to backend
        except Exception as e:
            error_msg = str(e)
            self.report({'ERROR'}, f"Python Error: {error_msg}")
            self.report_error_to_backend(error_msg, code)

    def report_error_to_backend(self, error, code):
        """Reports a execution error back to the backend for self-healing."""
        props = bpy.context.scene.baila_props
        try:
            payload = {
                "job_id": self._job_id,
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

# --- Registration ---
classes = (
    BAILA_Properties,
    VIEW3D_PT_baila_panel,
    BAILA_OT_send_prompt,
)

def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.Scene.baila_props = bpy.props.PointerProperty(type=BAILA_Properties)

def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
    del bpy.types.Scene.baila_props

if __name__ == "__main__":
    register()
