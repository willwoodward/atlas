import FitnessPage from '../desktop/FitnessPage.jsx'

// The tablet layout is a full-screen swipe deck; this page reuses the desktop
// one with the deck's padding rather than duplicating the chart and list.
export default function TabletFitnessPage() {
  return (
    <div style={{ padding: '14px 44px 30px' }}>
      <FitnessPage />
    </div>
  )
}
