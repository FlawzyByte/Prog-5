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

async function get(url: string) {
  const res = await fetch(url, { method: 'GET', headers: { 'content-type': 'application/json' } })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

function Grid({ title, cells, onClick, shipPlacements }: { title: string; cells: string[]; onClick?: (c: string) => void; shipPlacements?: string[] }) {
  return (
    <div>
      <h3 className="heading">{title}</h3>
      <div className="grid">
        {['A1','A2','A3','B1','B2','B3','C1','C2','C3'].map((c) => {
          const isPlaced = shipPlacements?.includes(c)
          const isSelected = cells.includes(c) && !isPlaced
          const classes = ['cell']
          if (isSelected) classes.push('selected')
          if (isPlaced) classes.push('placed')
          
          return (
            <div 
              key={c} 
              className={classes.join(' ')} 
              onClick={() => onClick?.(c)}
            >
              {isPlaced ? '🚢' : c}
            </div>
          )
        })}
      </div>
    </div>
  )
}

type Player = string | { id: string; username: string }

export function App() {
  const [username, setUsername] = useState('')
  const [user, setUser] = useState<{ id: string; username: string } | null>(null)
  const [room, setRoom] = useState<{ roomId: string; players: Player[]; turn: string; timeLimit?: number } | null>(null)
  const [roomIdInput, setRoomIdInput] = useState('')
  const [timeLimit, setTimeLimit] = useState<number>(3)
  const [myShips, setMyShips] = useState<string[]>([])
  const [shots, setShots] = useState<string[]>([])
  const [selectedShot, setSelectedShot] = useState<string | null>(null)
  const [hasFiredThisTurn, setHasFiredThisTurn] = useState<boolean>(false)
  const [messages, setMessages] = useState<string[]>([])
  const [lastHit, setLastHit] = useState<string | null>(null)
  const [winner, setWinner] = useState<string | null>(null)
  const [phase, setPhase] = useState<'placement' | 'battle' | 'waiting'>('placement')
  const [availableRooms, setAvailableRooms] = useState<Array<{ roomId: string; players: Player[]; playerCount: number; hasSpace: boolean }>>([])
  const [timeRemaining, setTimeRemaining] = useState<number>(0) // in seconds
  const [winnerName, setWinnerName] = useState<string | null>(null)

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
    s.on('gameOver', (m: any) => { 
      setWinner(m.winnerId)
      setMessages((x) => [...x, `gameOver: ${JSON.stringify(m)}`])
      
      // Fetch winner username
      if (m.winnerId) {
        fetch(`${USER}/users/${m.winnerId}`)
          .then(res => res.json())
          .then(data => setWinnerName(data.username || m.winnerId))
          .catch(() => setWinnerName(m.winnerId))
      }
    })
    return () => { s.close() }
  }, [socket])

  // Helper function to get player ID (handles both string and object formats)
  const getPlayerId = (p: Player): string => typeof p === 'string' ? p : p.id
  const getPlayerUsername = (p: Player): string => typeof p === 'string' ? p : (p.username || p.id)

  // Transition logic based on room updates
  useEffect(() => {
    if (!room) return
    const playerCount = (room.players || []).length
    if (phase === 'waiting' && playerCount >= 2) {
      setPhase(myShips.length >= 1 ? 'battle' : 'placement')
    }
  }, [room, phase, myShips.length])

  // Poll for available rooms when user is logged in but not in a room
  useEffect(() => {
    if (!user || room) return
    
    const checkAvailableRooms = async () => {
      try {
        const data = await get(`${ROOM}/rooms`)
        setAvailableRooms(data.rooms || [])
      } catch (e: any) {
        setMessages((x) => [...x, `Error checking rooms: ${String(e)}`])
      }
    }
    
    checkAvailableRooms()
    const interval = setInterval(checkAvailableRooms, 2000) // Poll every 2 seconds
    
    return () => clearInterval(interval)
  }, [user, room])

  const canPlace = user && room && phase === 'placement' && myShips.length < 1
  const isMyTurn = !!(user && room && room.turn === user.id)
  const canFire = user && room && phase === 'battle' && isMyTurn && !!selectedShot && !hasFiredThisTurn

  // Timer countdown when in battle phase - only runs during your turn
  useEffect(() => {
    if (phase !== 'battle' || !room?.timeLimit) {
      setTimeRemaining(0)
      return
    }
    
    // Initialize timer on first battle phase entry
    const totalSeconds = room.timeLimit * 60
    const myTurn = !!(user && room && room.turn === user.id)
    
    if (timeRemaining === 0) {
      setTimeRemaining(totalSeconds)
    }
    
    // Only countdown if it's your turn
    if (!myTurn) {
      return
    }
    
    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          return 0
        }
        return prev - 1
      })
    }, 1000)
    
    return () => clearInterval(interval)
  }, [phase, room?.timeLimit, room?.turn, user?.id, timeRemaining])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  async function handleSurrender() {
    if (!room || !user || phase !== 'battle') return
    if (window.confirm('Are you sure you want to surrender?')) {
      try {
        await post(`${GAME}/game/${room.roomId}/surrender`, { playerId: user.id })
        socket?.emit('surrender', { roomId: room.roomId, playerId: user.id })
      } catch (e: any) {
        setMessages((x) => [...x, `Surrender error: ${String(e)}`])
      }
    }
  }

  async function handleLogin() {
    if (!username.trim()) return
    const u = (await post(`${USER}/users`, { username })) as any
    setUser(u)
  }

  async function handleCreateRoom() {
    if (!user) return
    const r = (await post(`${ROOM}/rooms`, { userId: user.id, timeLimit })) as any
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

  async function handleJoinAvailableRoom(roomId: string) {
    if (!user) return
    const r = (await post(`${ROOM}/rooms/${roomId}/join`, { userId: user.id })) as any
    setRoom(r)
    socket?.emit('joinRoom', { roomId: r.roomId, playerId: user.id })
    setPhase('placement')
    setMessages((x) => [...x, `Joined available room ${roomId}`])
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
        const playerCount = (room.players || []).length
        setPhase(playerCount >= 2 ? 'battle' : 'waiting')
        setMessages((x) => [...x, playerCount >= 2 ? 'Placement complete. Battle phase started.' : 'Waiting for another player...'])
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
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <label>Time Limit: </label>
            <select value={timeLimit} onChange={(e) => setTimeLimit(Number(e.target.value))} style={{ padding: '4px 8px', backgroundColor: '#0b1224', border: '1px solid #1f2937', color: 'var(--text)', borderRadius: '6px' }}>
              <option value={1}>1 minute</option>
              <option value={2}>2 minutes</option>
              <option value={3}>3 minutes</option>
            </select>
          </div>
          <button onClick={handleCreateRoom}>Create room</button>
          
          {availableRooms.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ color: 'var(--success)', marginBottom: 8 }}>Available rooms to join:</div>
              {availableRooms.map((availableRoom) => {
                const playerNames = availableRoom.players.map(p => getPlayerUsername(p)).join(', ')
                return (
                  <div key={availableRoom.roomId} style={{ marginBottom: 8 }}>
                    <button 
                      className="btn primary" 
                      onClick={() => handleJoinAvailableRoom(availableRoom.roomId)}
                    >
                      Join Room {availableRoom.roomId} ({availableRoom.playerCount}/2) {playerNames && `- ${playerNames}`}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          
          <div style={{ marginTop: 12, fontSize: '0.9em', color: 'var(--muted)' }}>
            Or manually:
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <input placeholder="room id" value={roomIdInput} onChange={(e) => setRoomIdInput(e.target.value)} />
            <button onClick={handleJoinRoom}>Join by ID</button>
          </div>
        </div>
      )}

      {user && room && phase === 'placement' && (
        <div style={{ display: 'flex', marginTop: 16 }}>
          <Grid title={`Your ship (select 1 cell)`} cells={myShips} onClick={handlePlace} shipPlacements={myShips} />
        </div>
      )}

      {user && room && phase === 'battle' && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <div className="column">
            <h3 className="heading">Enemy grid</h3>
            <div className="grid">
              {['A1','A2','A3','B1','B2','B3','C1','C2','C3'].map((c) => {
                const fired = shots.includes(c)
                const selected = selectedShot === c
                const hit = lastHit === c
                const cls = ['cell', fired ? 'fired' : '', selected ? 'selected' : '', hit ? 'hit hit-animate' : ''].join(' ')
                return <div key={c} className={cls} onClick={() => selectTarget(c)}>{c}</div>
              })}
            </div>
          </div>
          <div className="controls">
            <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: 8 }}>
              Time: <strong style={{ color: timeRemaining < 60 ? 'var(--danger)' : 'var(--text)' }}>{formatTime(timeRemaining)}</strong>
            </div>
            <button className="btn primary" disabled={!canFire} onClick={commitFire}>Fire</button>
            <button className="btn" disabled={!selectedShot || !isMyTurn || hasFiredThisTurn} onClick={undoSelection}>Undo</button>
            <button className="btn" style={{ background: 'var(--danger)', borderColor: '#7f1d1d', color: 'white' }} onClick={handleSurrender}>Surrender</button>
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
            {(room.players || []).map((p, idx) => {
              const playerId = getPlayerId(p)
              const playerUsername = getPlayerUsername(p)
              return (
                <span key={playerId} style={{ color: user && playerId === user.id ? 'var(--success)' : 'var(--text)' }}>
                  {playerUsername}{idx < (room.players?.length || 0) - 1 ? ', ' : ''}
                </span>
              )
            })}
          </div>
          {myShips.length > 0 && (
            <div style={{ marginTop: 8, padding: '8px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '6px' }}>
              <strong>Your Ship Location:</strong> <code style={{ color: 'var(--accent)' }}>{myShips[0]}</code> 🚢
            </div>
          )}
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
            <p>Winner: <strong style={{ color: 'var(--accent)' }}>{winnerName || winner}</strong></p>
            <button className="btn" onClick={() => window.location.reload()}>Play again</button>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}


