"use client";

import { use, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getTicket, addTicketNote, resolveTicket, sendTicketEmail } from "../../../lib/api";
import { TicketDetailResponse } from "../../../types";
import { formatCurrency, formatDateTime, formatCauseLabel } from "../../../lib/formatters";
import { Badge } from "../../../components/Badge";
import { TicketEmailModal } from "../../../components/TicketEmailModal";
import { ArrowRight } from "lucide-react";

interface TicketDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function TicketDetailPage({ params }: TicketDetailPageProps) {
  const { id } = use(params);
  const [detail, setDetail] = useState<TicketDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newNote, setNewNote] = useState("");
  const [noteAuthor, setNoteAuthor] = useState("Agent Sarah");
  const [submittingNote, setSubmittingNote] = useState(false);

  const [resolving, setResolving] = useState(false);

  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [includePaymentLink, setIncludePaymentLink] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatusMsg, setEmailStatusMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const loadDetail = useCallback(() => {
    getTicket(id)
      .then((data) => {
        setDetail(data);
        setLoading(false);
        if (data.customer) {
          setEmailSubject(`Update regarding your reference ${data.ticket.entityId}`);
          setEmailMessage(
            `Hi ${data.customer.name},\n\nWe are following up regarding the pending balance of ${formatCurrency(data.event?.amount ?? 0)}. Please let us know if you need assistance completing this payment.\n\nBest regards,\nRazorRecovery Support`
          );
        }
      })
      .catch((err) => {
        console.error("Failed to load ticket:", err);
        setError("Failed to load ticket " + id);
        setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    try {
      setSubmittingNote(true);
      await addTicketNote(id, { author: noteAuthor, content: newNote.trim(), type: "agent_note" });
      setNewNote("");
      const updated = await getTicket(id);
      setDetail(updated);
    } catch (err) {
      console.error("Failed to add note:", err);
    } finally {
      setSubmittingNote(false);
    }
  };

  const handleResolve = async (status: "recovered" | "written_off" | "resolved" | "open") => {
    try {
      setResolving(true);
      await resolveTicket(id, {
        status,
        agentName: noteAuthor,
        resolutionNotes: `Status changed to ${status} by ${noteAuthor}`,
        recoveredAmount: status === "recovered" ? detail?.event?.amount : undefined,
      });
      const updated = await getTicket(id);
      setDetail(updated);
    } catch (err) {
      console.error("Failed to resolve ticket:", err);
    } finally {
      setResolving(false);
    }
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailSubject || !emailMessage) return;
    try {
      setSendingEmail(true);
      setEmailStatusMsg(null);
      const res = await sendTicketEmail(id, {
        subject: emailSubject,
        message: emailMessage,
        includePaymentLink,
        agentName: noteAuthor,
      });
      setEmailStatusMsg({
        text: `Email sent successfully.${res.paymentUrl ? ` Payment link: ${res.paymentUrl}` : ""}`,
        type: "success",
      });
      const updated = await getTicket(id);
      setDetail(updated);
    } catch (err: any) {
      setEmailStatusMsg({
        text: err?.response?.data?.error || "Failed to send email.",
        type: "error",
      });
    } finally {
      setSendingEmail(false);
    }
  };

  const notes = detail?.ticket.notes || detail?.notes || [];
  const customerName = detail?.customer?.name ?? detail?.ticket.entityId ?? id;

  return (
    <div className="pb-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-ink-faint mb-4">
        <Link href="/tickets" className="hover:text-ink transition-colors">
          Escalations
        </Link>
        <span>/</span>
        <span className="text-ink font-semibold truncate max-w-xs">
          {loading ? "Loading..." : customerName}
        </span>
      </nav>

      {loading ? (
        <div className="bg-white border border-hairline rounded-[12px] p-8 text-center text-ink-muted text-xs shadow-notion-soft">
          Loading escalation details...
        </div>
      ) : error ? (
        <div className="bg-accent-orange/10 border border-accent-orange/25 text-accent-orange-deep p-4 rounded-[8px] text-xs">
          {error}
        </div>
      ) : detail ? (
        <div>
          {/* Header */}
          <div className="bg-white border border-hairline rounded-[12px] p-5 mb-5 shadow-notion-soft">
            <div className="flex flex-wrap items-start justify-between gap-6">
              {/* Left: identity */}
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 mb-2 flex-wrap">
                  <h1 className="text-xl font-bold text-ink tracking-[-0.625px]">{customerName}</h1>
                  <Badge type="ticketStatus" value={detail.ticket.status} />
                  {/* <Badge
                    type="riskTier"
                    value={
                      detail.customer?.riskTier ||
                      (detail.event?.riskScore !== null && detail.event?.riskScore !== undefined
                        ? detail.event.riskScore > 0.7
                          ? "high"
                          : detail.event.riskScore > 0.4
                          ? "standard"
                          : "low"
                        : "standard")
                    }
                  /> */}
                </div>
                <div className="text-xs text-ink-muted space-y-0.5">
                  {detail.customer?.email && <div className="text-ink font-medium">{detail.customer.email}</div>}
                  <div className="text-ink-faint">
                    Entity:{" "}
                    <Link href={`/entities/${detail.ticket.entityId}`} className="text-primary hover:underline font-medium">
                      {detail.ticket.entityId}
                    </Link>
                  </div>
                  <div className="text-ink-faint">Ticket ID: {detail.ticket.id}</div>
                  <div className="text-ink-faint">Escalated: {formatDateTime(detail.ticket.createdAt)}</div>
                </div>
              </div>

              {/* Right: amount + actions */}
              <div className="flex flex-col items-end gap-3 shrink-0">
                {detail.event && (
                  <div className="text-right">
                    <div className="text-xs text-ink-muted mb-0.5">Amount at Risk</div>
                    <div className="text-2xl font-bold text-accent-orange tracking-heading-3">
                      {formatCurrency(detail.event.amount, detail.event.currency)}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowEmailModal(true)}
                    className="px-4 py-1.5 text-xs bg-primary text-white rounded-full hover:bg-primary-active active:scale-[0.98] font-medium transition-all shadow-sm"
                  >
                    Send Email
                  </button>
                  {detail.ticket.status !== "recovered" && (
                    <button
                      type="button"
                      disabled={resolving}
                      onClick={() => handleResolve("recovered")}
                      className="px-4 py-1.5 text-xs bg-accent-green/10 text-accent-green border border-accent-green/30 rounded-full hover:bg-accent-green/20 disabled:opacity-50 font-semibold transition-colors"
                    >
                      Mark Recovered
                    </button>
                  )}
                  {detail.ticket.status !== "written_off" && (
                    <button
                      type="button"
                      disabled={resolving}
                      onClick={() => handleResolve("written_off")}
                      className="px-4 py-1.5 text-xs bg-accent-orange/10 text-accent-orange-deep border border-accent-orange/30 rounded-full hover:bg-accent-orange/20 disabled:opacity-50 font-semibold transition-colors"
                    >
                      Write Off
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Main 2-col layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Left (2/3): activity + notes */}
            <div className="lg:col-span-2 space-y-4">

              {/* Triggering event */}
              {detail.event && (
                <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
                  <h2 className="text-[16px] font-bold text-ink tracking-[-0.125px] mb-3.5">Triggering Event</h2>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs">
                    <div>
                      <span className="text-ink-muted">Event Type: </span>
                      <span className="text-ink font-semibold">{detail.event.eventType}</span>
                    </div>
                    <div>
                      <span className="text-ink-muted">Amount: </span>
                      <span className="font-bold text-ink">
                        {formatCurrency(detail.event.amount, detail.event.currency)}
                      </span>
                    </div>
                    <div>
                      <span className="text-ink-muted">Failure Cause: </span>
                      <span className="text-ink-secondary font-medium">
                        {formatCauseLabel(detail.event.causeLabel)}
                      </span>
                    </div>
                    <div>
                      <span className="text-ink-muted">Error Reason: </span>
                      <span className="text-ink-muted">{detail.event.errorReason || "N/A"}</span>
                    </div>
                    {detail.ticket.resolvedAt && (
                      <div>
                        <span className="text-ink-muted">Resolved At: </span>
                        <span className="text-accent-green font-semibold">{formatDateTime(detail.ticket.resolvedAt)}</span>
                      </div>
                    )}
                  </div>
                  {detail.ticket.resolutionNotes && (
                    <div className="mt-3.5 pt-3.5 border-t border-hairline text-xs">
                      <span className="text-ink-muted font-medium block mb-1">Resolution Notes</span>
                      <div className="text-ink-secondary whitespace-pre-wrap bg-canvas-soft border border-hairline rounded-[6px] p-3 leading-relaxed">
                        {detail.ticket.resolutionNotes}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Activity & notes */}
              <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
                <h2 className="text-[16px] font-bold text-ink tracking-[-0.125px] mb-3.5 flex items-center justify-between">
                  <span>Activity & Internal Notes</span>
                  <span className="text-xs bg-canvas-soft text-ink-muted border border-hairline px-2.5 py-0.5 rounded-full font-semibold">
                    {notes.length}
                  </span>
                </h2>

                {notes.length === 0 ? (
                  <div className="text-xs text-ink-faint italic py-6 text-center">No notes recorded yet.</div>
                ) : (
                  <div className="space-y-2.5 mb-4">
                    {notes.map((note) => (
                      <div
                        key={note.id}
                        className={`p-3.5 rounded-[8px] border text-xs leading-relaxed ${
                          note.type === "email_sent"
                            ? "bg-primary/5 border-primary/20"
                            : note.type === "status_change"
                            ? "bg-canvas-soft border-hairline"
                            : "bg-accent-purple/10 border-accent-purple/30"
                        }`}
                      >
                        <div className="flex justify-between items-center text-[11px] text-ink-muted mb-1">
                          <span className="font-semibold text-ink">{note.author}</span>
                          <span className="text-ink-faint">{formatDateTime(note.createdAt)}</span>
                        </div>
                        <div className="text-ink-secondary whitespace-pre-wrap">{note.content}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add note form */}
                <form onSubmit={handleAddNote} className="pt-3.5 border-t border-hairline space-y-2.5">
                  <div className="text-xs font-semibold text-ink">Add Internal Note</div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Agent name..."
                      value={noteAuthor}
                      onChange={(e) => setNoteAuthor(e.target.value)}
                      className="px-3 py-1.5 bg-white border border-hairline-input rounded-[4px] text-xs text-ink placeholder:text-ink-faint w-1/3 focus:outline-none focus:border-primary focus:shadow-notion-soft transition-all"
                    />
                    <input
                      type="text"
                      placeholder="Type note or call summary..."
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      className="flex-1 px-3 py-1.5 bg-white border border-hairline-input rounded-[4px] text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-primary focus:shadow-notion-soft transition-all"
                    />
                    <button
                      type="submit"
                      disabled={submittingNote || !newNote.trim()}
                      className="px-4 py-1.5 bg-ink text-white rounded-[8px] hover:bg-ink-secondary disabled:opacity-50 text-xs font-medium whitespace-nowrap transition-colors"
                    >
                      {submittingNote ? "Adding..." : "Add Note"}
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* Right (1/3): customer + assignment */}
            <div className="space-y-4">
              {/* Customer profile */}
              {detail.customer && (
                <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
                  <h2 className="text-[16px] font-bold text-ink tracking-[-0.125px] mb-3.5">Customer Profile</h2>
                  <div className="space-y-2.5 text-xs">
                    <div className="font-semibold text-ink text-sm">{detail.customer.name}</div>
                    <div className="text-ink-muted">{detail.customer.email}</div>
                    {detail.customer.phone && (
                      <div className="text-ink-muted">{detail.customer.phone}</div>
                    )}
                    <div className="pt-2.5 space-y-2 border-t border-hairline">
                      <div className="flex justify-between items-center">
                        <span className="text-ink-muted">Risk Tier</span>
                        <Badge type="riskTier" value={detail.customer.riskTier} />
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-ink-muted">Lifetime Value</span>
                        <span className="font-bold text-ink">
                          {formatCurrency(detail.customer.lifetimeValue)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-ink-muted">DNC Flag</span>
                        <span className={detail.customer.dncFlag ? "text-accent-orange font-bold" : "text-accent-green font-medium"}>
                          {detail.customer.dncFlag ? "Yes" : "No"}
                        </span>
                      </div>
                    </div>
                    <div className="pt-2.5 border-t border-hairline">
                      <Link
                        href={`/entities/${detail.ticket.entityId}`}
                        className="text-primary hover:underline text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <span>View Entity Audit Trail</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              )}

              {/* Ticket metadata */}
              <div className="bg-white border border-hairline rounded-[12px] p-5 shadow-notion-soft">
                <h2 className="text-[16px] font-bold text-ink tracking-[-0.125px] mb-3.5">Ticket Details</h2>
                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-ink-muted">Status</span>
                    <Badge type="ticketStatus" value={detail.ticket.status} />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-ink-muted">Risk Tier</span>
                    <Badge
                      type="riskTier"
                      value={
                        detail.customer?.riskTier ||
                        (detail.event?.riskScore !== null && detail.event?.riskScore !== undefined
                          ? detail.event.riskScore > 0.7
                            ? "high"
                            : detail.event.riskScore > 0.4
                            ? "standard"
                            : "low"
                          : "standard")
                      }
                    />
                  </div>
                  {detail.ticket.assignedTo && (
                    <div className="flex justify-between items-center">
                      <span className="text-ink-muted">Assigned To</span>
                      <span className="text-ink font-medium">{detail.ticket.assignedTo}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-ink-muted">Notes Count</span>
                    <span className="text-ink font-semibold">{notes.length}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-ink-muted">Created</span>
                    <span className="text-ink-muted">{formatDateTime(detail.ticket.createdAt)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-ink-muted">Updated</span>
                    <span className="text-ink-muted">{formatDateTime(detail.ticket.updatedAt)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showEmailModal && detail && (
        <TicketEmailModal
          isOpen={showEmailModal}
          onClose={() => setShowEmailModal(false)}
          customerName={detail.customer?.name}
          customerEmail={detail.customer?.email}
          amount={detail.event?.amount}
          subject={emailSubject}
          onSubjectChange={setEmailSubject}
          message={emailMessage}
          onMessageChange={setEmailMessage}
          includePaymentLink={includePaymentLink}
          onIncludePaymentLinkChange={setIncludePaymentLink}
          onSubmit={handleSendEmail}
          sending={sendingEmail}
          statusMsg={emailStatusMsg}
        />
      )}
    </div>
  );
}
