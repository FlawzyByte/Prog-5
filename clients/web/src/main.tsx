import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import './style.css'

const root = createRoot(document.getElementById('root')!)
root.render(<App />)


