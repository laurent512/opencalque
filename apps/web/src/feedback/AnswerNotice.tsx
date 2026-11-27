import { MessageSquare, X } from 'lucide-react'
import { t } from '../i18n'
import { useWindows } from '../windows'
import { dismissAnswers, listed, useMyReports } from './mine'

/**
 * The notice in the top right corner, under the menu bar, that a report sent from here has a new answer: it stays
 * until it is read (a click on it opens the report in the Feedback window) or dismissed, and is not shown
 * while the Feedback window is open. Dismissed, the report keeps its mark in the window's list.
 */
export function AnswerNotice() {
  const announced = useMyReports((s) => s.announced)
  const reports = useMyReports(listed)
  const feedbackOpen = useWindows((s) => s.feedbackOpen)
  const first = reports.find((r) => r.number === announced[0])
  if (!first || feedbackOpen) return null
  const read = () => {
    useWindows.setState({ feedbackOpen: true, feedbackReport: first.number })
    dismissAnswers()
  }
  // The whole notice opens the report; its cross lets it go without opening it.
  return (
    <div
      className="answer-notice"
      role="button"
      tabIndex={0}
      title={first.title}
      onClick={read}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        read()
      }}
    >
      <MessageSquare size={16} className="answer-notice-icon" />
      <div className="answer-notice-text">
        <strong>{announced.length === 1 ? t('New answer to your report') : t('New answers to {count} of your reports', { count: announced.length })}</strong>
        <span>{first.title}</span>
      </div>
      <button
        className="icon-button"
        title={t('Dismiss')}
        aria-label={t('Dismiss')}
        onClick={(e) => {
          e.stopPropagation()
          dismissAnswers()
        }}
      >
        <X size={14} />
      </button>
    </div>
  )
}
