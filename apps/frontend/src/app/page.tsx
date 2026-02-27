"use client";

import React, { useState, useEffect } from 'react';
import {
  Activity,
  Database,
  Code,
  Shield,
  Cpu,
  Layout,
  Server,
  Terminal,
  BookOpen,
  FileText,
  Github,
  Info
} from 'lucide-react';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('overview'); // overview, manual, docs
  const [status, setStatus] = useState({ backend: 'offline', ollama: 'offline' });

  useEffect(() => {
    setStatus({ backend: 'online', ollama: 'online (llama3)' });
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col">
      {/* Header */}
      <header className="flex justify-between items-center p-6 border-b border-zinc-800 bg-zinc-900/30 sticky top-0 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600 rounded-lg">
            <Layout className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">B-AILA <span className="text-zinc-500 font-normal">Hub</span></h1>
        </div>

        <nav className="hidden md:flex bg-zinc-900 border border-zinc-800 rounded-lg p-1">
          <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} icon={<Activity className="w-4 h-4" />} label="Overview" />
          <TabButton active={activeTab === 'manual'} onClick={() => setActiveTab('manual')} icon={<BookOpen className="w-4 h-4" />} label="User Manual" />
          <TabButton active={activeTab === 'docs'} onClick={() => setActiveTab('docs')} icon={<FileText className="w-4 h-4" />} label="Developer Docs" />
        </nav>

        <div className="flex gap-3">
          <StatusBadge label="Backend" status={status.backend} />
          <StatusBadge label="Ollama" status={status.ollama} />
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        {activeTab === 'overview' && <OverviewView />}
        {activeTab === 'manual' && <ManualView />}
        {activeTab === 'docs' && <DocsView />}
      </main>

      {/* Footer / Open Source Info */}
      <footer className="p-6 border-t border-zinc-900 flex justify-between items-center text-zinc-500 text-sm">
        <div className="flex items-center gap-2">
          <Github className="w-4 h-4" />
          <span>Open Source Project by JhonDev</span>
        </div>
        <div className="flex gap-4">
          <a href="#" className="hover:text-zinc-300">View on GitHub</a>
          <span>v0.1.0-alpha</span>
        </div>
      </footer>
    </div>
  );
}

// --- View Components ---

function OverviewView() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-2">
      <section className="space-y-6">
        <Card title="System Performance" icon={<Activity className="w-5 h-5 text-indigo-400" />}>
          <div className="space-y-4">
            <StatBar label="CPU Usage" value={45} />
            <StatBar label="VRAM Usage" value={78} />
          </div>
        </Card>

        <Card title="Active Models" icon={<Server className="w-5 h-5 text-emerald-400" />}>
          <div className="space-y-2">
            <div className="p-3 bg-zinc-900 rounded border border-zinc-800 flex justify-between items-center">
              <span>codellama:7b</span>
              <span className="text-xs bg-emerald-500/10 text-emerald-500 px-2 py-1 rounded">Active</span>
            </div>
            <div className="p-3 bg-zinc-900 rounded border border-zinc-800 flex justify-between items-center text-zinc-500">
              <span>llama3:8b</span>
              <button className="text-xs hover:text-white transition-colors">Load</button>
            </div>
          </div>
        </Card>
      </section>

      <section className="lg:col-span-2 space-y-6">
        <Card title="Execution Logs & Self-Healing" icon={<Code className="w-5 h-5 text-amber-400" />}>
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
            <div className="p-3 bg-zinc-800/50 flex items-center gap-2 text-xs font-mono text-zinc-400 border-b border-zinc-700">
              <Terminal className="w-4 h-4" /> B-AILA_HISTORY.LOG
            </div>
            <div className="p-4 space-y-4 font-mono text-sm h-[400px] overflow-y-auto">
              <LogItem type="info" message="Handshake established with Blender Client." />
              <LogItem type="info" message="Generation job uuid-123 started (codellama)." />
              <LogItem type="error" message="SyntaxError: unexpected EOF while parsing at line 4 (Blender-V3)." />
              <LogItem type="warning" message="Self-healing triggered: sending error details to backend." />
              <LogItem type="success" message="Model re-generation successful. Code executed." />
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}

function ManualView() {
  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-2">
      <div className="text-center space-y-4 mb-12">
        <h2 className="text-4xl font-bold">Manual do Usuário</h2>
        <p className="text-zinc-400">Tudo o que você precisa saber para dominar o B-AILA.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ManualSection title="Como Iniciar" icon={<BookOpen className="text-indigo-400" />}>
          Execute o script <code className="bg-zinc-800 px-1 rounded">install.ps1</code> no PowerShell como Admin e ative o Add-on no Blender seguindo as instruções de setup.
        </ManualSection>
        <ManualSection title="Interação com IA" icon={<Info className="text-emerald-400" />}>
          Utilize o painel lateral no Blender. A IA recebe automaticamente o contexto da sua seleção atual para gerar comandos Python precisos.
        </ManualSection>
        <ManualSection title="Auto-Execução" icon={<Shield className="text-rose-400" />}>
          O recurso 'Auto-Run' executa scripts gerados instantaneamente. Recomendamos desativar para testes iniciais de maior complexidade.
        </ManualSection>
        <ManualSection title="Open Source" icon={<Github className="text-zinc-400" />}>
          O B-AILA é livre! Sinta-se à vontade para abrir o código, sugerir melhorias e colaborar com a comunidade no GitHub.
        </ManualSection>
      </div>
    </div>
  );
}

function DocsView() {
  const docs = [
    { title: 'System Architecture', file: 'architecture.md', description: 'Technical design and local-first approach.' },
    { title: 'API Protocol', file: 'api_protocol.md', description: 'Blender <-> Backend communication flow.' },
    { title: 'Installation Guide', file: 'installation.md', description: 'Hardware requirements and infrastructure setup.' },
    { title: 'Uninstallation', file: 'uninstallation_guide.md', description: 'Complete cleanup process.' }
  ];

  return (
    <div className="max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-2">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-2">Technical Documentation</h2>
        <p className="text-zinc-500 text-sm">Explore the internal workings of the B-AILA ecosystem.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {docs.map(doc => (
          <div key={doc.file} className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-indigo-500/50 cursor-pointer group transition-all">
            <h3 className="font-semibold text-zinc-100 group-hover:text-indigo-400 mb-1">{doc.title}</h3>
            <p className="text-xs text-zinc-500 mb-3">{doc.description}</p>
            <span className="text-[10px] uppercase tracking-wider text-zinc-600 border border-zinc-800 px-2 py-0.5 rounded italic">Source: {doc.file}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- UI Sub-components ---

function TabButton({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm transition-all ${active ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ManualSection({ title, icon, children }) {
  return (
    <div className="p-6 bg-zinc-900 border border-zinc-800 rounded-2xl space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-zinc-800 rounded-lg">{icon}</div>
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>
      <p className="text-sm text-zinc-400 leading-relaxed">{children}</p>
    </div>
  );
}

function StatusBadge({ label, status }) {
  const isOnline = status.includes('online');
  return (
    <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-full text-xs">
      <span className="text-zinc-500 font-medium">{label}</span>
      <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500'}`} />
    </div>
  );
}

function Card({ title, icon, children }) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4 px-1">
        {icon}
        <h2 className="font-semibold text-sm text-zinc-300 uppercase tracking-wider">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function StatBar({ label, value }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-zinc-400">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function LogItem({ type, message }) {
  const colors = {
    info: 'text-zinc-400',
    error: 'text-rose-400',
    warning: 'text-amber-400',
    success: 'text-emerald-400'
  };
  return (
    <div className="flex gap-3 text-[13px]">
      <span className="text-zinc-700 font-mono">[{new Date().toLocaleTimeString()}]</span>
      <span className={`${colors[type] || colors.info} leading-tight`}>{message}</span>
    </div>
  );
}
