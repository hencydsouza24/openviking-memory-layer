import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { useEffect, useRef, useState } from 'preact/hooks';

import {
  lsMemory, readMemory, listModels, runTurn, textOf, type MemEvent,
} from './agent';

const sessionId = 'chat-' + Math.random().toString(36).slice(2, 10);
const ICONS: Record<string, string> = {
  find: '🔍', search: '🔍', browse: '📂', read: '📄', grep: '🔎', store: '💾',
  archive_search: '🗄️', archive_expand: '🗄️', add_resource: '📎', add_skill: '🧩', health: '❤️', forget: '🗑️',
};
const iconFor = (n: string) => ICONS[(n || '').replace('viking_', '')] || '🛠️';

interface Pending { call: { name: string; args: unknown }; resolve: (ok: boolean) => void; }
type Ev = MemEvent | { kind: 'turn'; label: string };
type Mem = { uri: string; root: string; entries: Awaited<ReturnType<typeof lsMemory>>; error?: string };

export function App() {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [convo, setConvo] = useState<BaseMessage[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [mem, setMem] = useState<Mem>({ uri: '', root: '', entries: [] });
  const [viewing, setViewing] = useState<{ uri: string; content: string } | null>(null);
  const convoRef = useRef<BaseMessage[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const evRef = useRef<HTMLDivElement>(null);

  useEffect(() => { listModels().then((m) => { setModels(m); setModel(m[0] || ''); }); browse(); }, []);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [convo, busy, pending]);
  useEffect(() => { if (evRef.current) evRef.current.scrollTop = evRef.current.scrollHeight; }, [events]);

  async function browse(uri?: string) {
    setViewing(null);
    try {
      const entries = await lsMemory(uri);
      setMem({ uri: uri || `viking://user`, root: '', entries });
    } catch (e: any) {
      setMem({ uri: uri || '', root: '', entries: [], error: String(e?.message ?? e) });
    }
  }
  async function openFile(uri: string) {
    try { setViewing({ uri, content: await readMemory(uri) }); }
    catch (e: any) { setViewing({ uri, content: String(e?.message ?? e) }); }
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    const prev = convoRef.current;
    setConvo([...prev, new HumanMessage(text)]);
    setEvents((es) => [...es, { kind: 'turn', label: text }]);
    setBusy(true);
    try {
      const next = await runTurn({
        sessionId, model, history: prev, userText: text,
        onEvent: (e) => setEvents((es) => [...es, e]),
        onApproval: (call) => new Promise<boolean>((resolve) => setPending({ call, resolve })),
      });
      convoRef.current = next;
      setConvo(next);
    } catch (e: any) {
      setConvo((c) => [...c, new AIMessage('⚠️ ' + String(e?.message ?? e))]);
    } finally {
      setBusy(false);
      browse(mem.uri && mem.uri !== 'viking://user' ? mem.uri : undefined);
    }
  }

  function decide(ok: boolean) {
    pending?.resolve(ok);
    setPending(null);
  }

  const bubbles = convo
    .map((m) => {
      if (m instanceof HumanMessage) return { role: 'user', text: textOf(m) };
      if (m instanceof AIMessage && !((m as AIMessage).tool_calls?.length)) {
        const t = textOf(m);
        return t.trim() ? { role: 'bot', text: t } : null;
      }
      return null;
    })
    .filter(Boolean) as { role: string; text: string }[];

  return (
    <>
      <header>
        <h1>🧠 OpenViking Memory Chat <span style="font-size:11px;color:#666;font-weight:400">· library running in-browser</span></h1>
        <label>model <select value={model} onChange={(e) => setModel((e.target as HTMLSelectElement).value)}>
          {models.map((m) => <option value={m}>{m}</option>)}
        </select></label>
        <span style="color:#888;font-size:12px">{sessionId}</span>
      </header>
      <main>
        <section id="chat">
          <div class="log" ref={logRef}>
            {bubbles.map((b, i) => <div class={'msg ' + b.role} key={i}>{b.text}</div>)}
            {pending && (
              <div class="approval">
                <b>⚠️ Approve memory write?</b>
                <pre>{pending.call.name}({JSON.stringify(pending.call.args)})</pre>
                <button class="primary" onClick={() => decide(true)}>Approve</button>
                <button class="danger" style="margin-left:8px" onClick={() => decide(false)}>Deny</button>
              </div>
            )}
            {busy && !pending && <div class="msg bot typing"><span /><span /><span /></div>}
          </div>
          <div class="composer">
            <input placeholder="Try: remember I'm vegetarian and allergic to peanuts" value={draft}
              disabled={busy} onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === 'Enter' && send()} />
            <button class="primary" disabled={busy} onClick={send}>Send</button>
          </div>
        </section>
        <aside>
          <h2>Memory activity (live)</h2>
          <div ref={evRef} style="max-height:45%;overflow-y:auto;margin-bottom:16px">
            {events.length === 0 && <div class="empty">tool calls appear here as the agent recalls / stores memory</div>}
            {events.map((ev, i) => {
              if (ev.kind === 'turn') return <div class="turnsep" key={i}>— {ev.label} —</div>;
              if (ev.kind === 'call') return (
                <div class={'ev call' + ((ev as MemEvent).write ? ' write' : '')} key={i}>
                  {iconFor(ev.name)} <b>{ev.name}</b> <span class="args">{JSON.stringify((ev as MemEvent).args)}</span>
                </div>
              );
              return (
                <div class="ev result" key={i}>↳ {(ev as MemEvent).status}
                  {(ev as MemEvent).preview && <span class="preview">{(ev as MemEvent).preview}</span>}
                </div>
              );
            })}
          </div>
          <h2>OpenViking memory <button class="refresh" onClick={() => browse()}>↻ root</button></h2>
          <div class="crumb">
            {(mem.uri || '').replace('viking://', '')}
            {mem.uri && mem.uri.includes('/') && <> · <a onClick={() => browse(mem.uri.split('/').slice(0, -1).join('/'))}>↑ up</a></>}
          </div>
          {mem.error && <div class="empty">{mem.error}</div>}
          {!mem.error && mem.entries.length === 0 && <div class="empty">empty — chat and store something</div>}
          {mem.entries.map((e, i) => (
            <div class="row" key={i} onClick={() => (e.isDir ? browse(e.uri) : openFile(e.uri))}>
              <span>{e.isDir ? '📁' : '📄'}</span>
              <span style="flex:1">{e.name}{e.abstract && <span class="ab"> — {e.abstract}</span>}</span>
            </div>
          ))}
          {viewing && (
            <div class="viewer">
              <b style="font-size:12px;word-break:break-all">{viewing.uri.split('/').pop()}</b>
              <button class="refresh" onClick={() => setViewing(null)}>✕</button>
              <pre>{viewing.content}</pre>
            </div>
          )}
        </aside>
      </main>
    </>
  );
}
