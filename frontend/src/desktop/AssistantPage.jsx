import AssistantChat from '../components/AssistantChat.jsx'
import { useIsMobile } from '../hooks/useIsMobile.js'

export default function AssistantPage() {
  const isMobile = useIsMobile()
  return (
    <AssistantChat
      orbSize={isMobile ? 130 : 200}
      ring1={isMobile ? 200 : 300}
      ring2={isMobile ? 160 : 240}
    />
  )
}
