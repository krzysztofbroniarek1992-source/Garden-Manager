import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { GardenProvider } from './state'
import './styles.css'
import './navigation/interface.css'
import { restoreNativeNavigation } from './platform/navigation'
import './platform/android.css'

void restoreNativeNavigation().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><GardenProvider><App /></GardenProvider></React.StrictMode>)
})
