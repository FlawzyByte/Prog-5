import React, { useEffect, useMemo, useState } from 'react'
import { io, Socket } from 'socket.io-client'

const USER = 'http://127.0.0.1:3001'
const ROOM = 'http://127.0.0.1:3002'
const GAME = 'http://127.0.0.1:3003'

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

function Grid({ title, cells, onClick }: { title: string; cells: string[]; onClick?: (c: string) => void }) {
  return (
    <div>
      <h3 className="heading">{title}</h3>
      <div className="grid">
        {['A1','A2','A3','A4','B1','B2','B3','B4','C1','C2','C3','C4','D1','D2','D3','D4'].map((c) => (
          <div key={c} className={['cell', cells.includes(c) ? 'selected' : ''].join(' ')} onClick={() => onClick?.(c)}>{c}</div>
        ))}
      </div>
    </div>
  )
}

export function App() {
  const [username, setUsername] = useState('')
  const [user, setUser] = useState<{ id: string; username: string } | null>(null)
  const [room, setRoom] = useState<{ roomId: string; players: string[]; turn: string } | null>(null)
  const [roomIdInput, setRoomIdInput] = useState('')
  const [myShips, setMyShips] = useState<string[]>([])
  const [shots, setShots] = useState<string[]>([])
  const [selectedShot, setSelectedShot] = useState<string | null>(null)
  const [hasFiredThisTurn, setHasFiredThisTurn] = useState<boolean>(false)
  const [messages, setMessages] = useState<string[]>([])
  const [lastHit, setLastHit] = useState<string | null>(null)
  const [winner, setWinner] = useState<string | null>(null)
  const [phase, setPhase] = useState<'placement' | 'battle' | 'waiting'>('placement')

  const socket: Socket | null = useMemo(() => (user ? io(GAME, { transports: ['websocket'] }) : null), [user])

  useEffect(() => {
    if (!socket) return
    const s = socket
    s.on('connect', () => setMessages((m) => [...m, 'WS connected']))
    s.on('joinRoomAck', (m: any) => { setRoom(m); setMessages((x) => [...x, `joinRoomAck: room ${m.roomId}`]) })
    s.on('roomUpdate', (m: any) => { setRoom(m); setMessages((x) => [...x, `roomUpdate: players=${(m.players||[]).length}`]) })
    s.on('placeShipAck', (m: any) => setMessages((x) => [...x, `placeShipAck: ${JSON.stringify(m)}`]))
    s.on('fireResult', (m: any) => { setMessages((x) => [...x, `fireResult: ${JSON.stringify(m)}`]); if (m.result === 'hit') setLastHit(m.coord) })
    s.on('turnChange', (m: any) => { 
      setRoom((r) => (r ? { ...r, turn: m.playerId } : r)); 
      setSelectedShot(null)
      setHasFiredThisTurn(false)
      setMessages((x) => [...x, `turnChange: ${JSON.stringify(m)}`]) 
    })
    s.on('gameOver', (m: any) => { setWinner(m.winnerId); setMessages((x) => [...x, `gameOver: ${JSON.stringify(m)}`]) })
    return () => { s.close() }
  }, [socket])

  // Transition logic based on room updates
  useEffect(() => {
    if (!room) return
    const playerCount = (room.players || []).length
    if (phase === 'waiting' && playerCount >= 2) {
      setPhase(myShips.length >= 1 ? 'battle' : 'placement')
    }
  }, [room, phase, myShips.length])

  const canPlace = user && room && phase === 'placement' && myShips.length < 1
  const isMyTurn = !!(user && room && room.turn === user.id)
  const canFire = user && room && phase === 'battle' && isMyTurn && !!selectedShot && !hasFiredThisTurn

  async function handleLogin() {
    if (!username.trim()) return
    const u = (await post(`${USER}/users`, { username })) as any
    setUser(u)
  }

  async function handleCreateRoom() {
    if (!user) return
    const r = (await post(`${ROOM}/rooms`, { userId: user.id })) as any
    setRoom(r)
    socket?.emit('joinRoom', { roomId: r.roomId, playerId: user.id })
    // Start with placement immediately for first player
    setPhase('placement')
  }

  async function handleJoinRoom() {
    if (!user || !roomIdInput) return
    const r = (await post(`${ROOM}/rooms/${roomIdInput}/join`, { userId: user.id })) as any
    setRoom(r)
    socket?.emit('joinRoom', { roomId: r.roomId, playerId: user.id })
    // Move to placement after joining
    setPhase('placement')
  }

  async function handlePlace(cell: string) {
    if (!canPlace || !room || !user) return
    // avoid duplicates
    if (myShips.includes(cell)) return
    const next = [cell]
    setMyShips(next)
    if (next.length === 1) {
      const ships = [ { from: next[0], to: next[0] } ]
      try {
        await post(`${GAME}/game/${room.roomId}/place`, { playerId: user.id, shipCoords: ships })
        // If opponent present, go battle; otherwise waiting
        setPhase(room.players.length >= 2 ? 'battle' : 'waiting')
        setMessages((x) => [...x, room.players.length >= 2 ? 'Placement complete. Battle phase started.' : 'Waiting for another player...'])
      } catch (e: any) {
        // if server rejects, allow retry by resetting selection
        setMessages((x) => [...x, `Placement error: ${String(e)}`])
        setMyShips([])
      }
    }
  }

  function selectTarget(cell: string) {
    if (phase !== 'battle' || !isMyTurn || hasFiredThisTurn) return
    if (selectedShot === cell) return
    setSelectedShot(cell)
  }

  async function commitFire() {
    if (!canFire || !room || !user || !selectedShot) return
    setShots((s) => [...s, selectedShot])
    await post(`${GAME}/game/${room.roomId}/fire`, { playerId: user.id, coord: selectedShot })
    socket?.emit('fire', { roomId: room.roomId, playerId: user.id, coord: selectedShot })
    setSelectedShot(null)
    setHasFiredThisTurn(true)
  }
  function undoSelection() {
    if (!isMyTurn || hasFiredThisTurn) return
    setSelectedShot(null)
  }

  return (
    <div className="app-shell">
      <div className="card">
      <h2 className="heading">Mini Battleship (Web)</h2>
      {!user && (
        <div>
          <input placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <button onClick={handleLogin}>Login</button>
        </div>
      )}

      {user && !room && (
        <div style={{ marginTop: 12 }}>
          <button onClick={handleCreateRoom}>Create room</button>
          <input placeholder="room id" value={roomIdInput} onChange={(e) => setRoomIdInput(e.target.value)} />
          <button onClick={handleJoinRoom}>Join room</button>
        </div>
      )}

      {user && room && phase === 'placement' && (
        <div style={{ display: 'flex', marginTop: 16 }}>
          <Grid title={`Your ship (select 1 cell)`} cells={myShips} onClick={handlePlace} />
        </div>
      )}

      {user && room && phase === 'battle' && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <div className="column">
            <h3 className="heading">Enemy grid</h3>
            <div className="grid">
              {['A1','A2','A3','A4','B1','B2','B3','B4','C1','C2','C3','C4','D1','D2','D3','D4'].map((c) => {
                const fired = shots.includes(c)
                const selected = selectedShot === c
                const hit = lastHit === c
                const cls = ['cell', fired ? 'fired' : '', selected ? 'selected' : '', hit ? 'hit hit-animate' : ''].join(' ')
                return <div key={c} className={cls} onClick={() => selectTarget(c)}>{c}</div>
              })}
            </div>
          </div>
          <div className="controls">
            <button className="btn primary" disabled={!canFire} onClick={commitFire}>Fire</button>
            <button className="btn" disabled={!selectedShot || !isMyTurn || hasFiredThisTurn} onClick={undoSelection}>Undo</button>
            {selectedShot && <span className="pill">Selected: {selectedShot}</span>}
            {isMyTurn ? <span className="pill" style={{ color: 'var(--success)' }}>Your turn</span> : <span className="pill">Opponent's turn</span>}
          </div>
        </div>
      )}

      {room && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div><strong>Room:</strong> <code>{room.roomId}</code></div>
          <div style={{ marginTop: 6 }}>
            <strong>Players:</strong>{' '}
            {(room.players || []).map((p, idx) => (
              <span key={p} style={{ color: user && p === user.id ? 'var(--success)' : 'var(--text)' }}>
                {p}{idx < (room.players?.length || 0) - 1 ? ', ' : ''}
              </span>
            ))}
          </div>
          {phase === 'waiting' && <div style={{ color: 'var(--warn)', marginTop: 8 }}>Waiting for another player...</div>}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <h3 className="heading">Messages</h3>
        <pre className="panel" style={{ maxHeight: 200, overflow: 'auto' }}>{messages.join('\n')}</pre>
      </div>

      {winner && (
        <div className="modal-backdrop">
          <div className={`modal ${winner === user?.id ? 'win' : 'lose'}`}>
            <h3>{winner === user?.id ? 'You Won!' : 'You Lost'}</h3>
            <p>Winner: <code>{winner}</code></p>
            <button className="btn" onClick={() => window.location.reload()}>Play again</button>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}


