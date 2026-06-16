import { useEffect, useRef, useState } from 'react'
import { Send, X, MessageSquare, Trash2 } from 'lucide-react'
import { Message } from '../types'
import { socket } from '../socket'
import { useStore, selectIsLeader } from '../store'
import Avatar from './Avatar'

interface ChatProps {
  messages: Message[]
  currentUserId: string
  chatEnabled: boolean
  onClose?: () => void
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
}

export default function Chat({ messages, currentUserId, chatEnabled, onClose }: ChatProps) {
  const isLeader = useStore(selectIsLeader)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, autoScroll])

  const handleScroll = () => {
    const el = listRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }

  const sendMessage = () => {
    const text = input.trim()
    if (!text) return
    socket.emit('room:message', { text })
    setInput('')
  }

  const deleteMessage = (messageId: string) => {
    socket.emit('room:delete_message', { messageId })
  }

  return (
    <div className="flex flex-col h-full glass-strong rounded-xl overflow-hidden"
      style={{ border: '1px solid rgba(255,255,255,0.06)' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2">
          <MessageSquare size={14} className="text-purple-400" />
          <span className="text-sm font-medium text-cinema-text">Chat</span>
          {!chatEnabled && (
            <span className="text-xs text-slate-500 bg-slate-800/50 px-2 py-0.5 rounded-full">
              Muted
            </span>
          )}
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-ghost p-1.5">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <MessageSquare size={24} className="text-slate-700 mb-2" />
            <p className="text-xs text-slate-600">No messages yet</p>
            <p className="text-xs text-slate-700 mt-1">Say something!</p>
          </div>
        )}

        {messages.map(msg => {
          const isOwn = msg.userId === currentUserId
          const isVisible = !msg.isWhisper || msg.userId === currentUserId || msg.whisperToId === currentUserId

          if (!isVisible) return null

          return (
            <div key={msg.id} className={`group flex items-start gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
              {/* Avatar */}
              <div className="mt-0.5">
                <Avatar seed={msg.userId} name={msg.nickname} src={msg.avatar} size={26} />
              </div>

              <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} flex-1 min-w-0`}>
                {/* Name + time */}
                <div className={`flex items-center gap-1.5 mb-0.5 ${isOwn ? 'flex-row-reverse' : ''}`}>
                  <span className={`text-xs font-medium ${isOwn ? 'text-purple-300' : 'text-slate-400'}`}>
                    {isOwn ? 'You' : msg.nickname}
                  </span>
                  <span className="text-xs text-slate-700">{formatTime(msg.timestamp)}</span>
                  {msg.isWhisper && (
                    <span className="text-xs text-purple-500/70">🤫</span>
                  )}
                </div>

                {/* Message bubble */}
                <div className={`relative max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                  msg.isWhisper
                    ? 'bg-purple-900/30 border border-purple-700/30 text-purple-200 italic'
                    : isOwn
                      ? 'bg-purple-600/20 border border-purple-600/20 text-cinema-text'
                      : 'bg-white/4 border border-white/5 text-cinema-text'
                }`}
                  style={{ wordBreak: 'break-word' }}
                >
                  {msg.isWhisper && (
                    <span className="text-xs text-purple-400 block mb-0.5">
                      {msg.userId === currentUserId ? `→ ${msg.whisperTo}` : '← whisper'}
                    </span>
                  )}
                  {msg.text}

                  {/* Delete button (leader only) */}
                  {isLeader && (
                    <button
                      onClick={() => deleteMessage(msg.id)}
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom button */}
      {!autoScroll && (
        <button
          onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
          className="mx-3 mb-1 text-xs text-purple-400 bg-purple-900/20 rounded-lg py-1.5 text-center hover:bg-purple-900/30 transition-colors"
        >
          ↓ New messages
        </button>
      )}

      {/* Input */}
      <div className="px-3 pb-3 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        {!chatEnabled && !isLeader ? (
          <div className="text-center text-xs text-slate-600 py-2">
            Chat is disabled by Leader
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder={chatEnabled ? 'Say something…' : 'Leader mode'}
              className="input-field text-sm py-2 flex-1"
              maxLength={500}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="btn-primary p-2 flex items-center justify-center"
            >
              <Send size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
