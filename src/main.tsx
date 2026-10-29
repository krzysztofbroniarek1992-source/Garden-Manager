import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { GardenProvider } from './state'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><GardenProvider><App /></GardenProvider></React.StrictMode>)
