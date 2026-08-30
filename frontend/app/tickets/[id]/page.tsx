"use client";

import { use, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getTicket, addTicketNote, resolveTicket, sendTicketEmail } from "../../../lib/api";
import { TicketDetailResponse } from "../../../types";
import { formatCurrency, formatDateTime } from "../../../lib/formatters";
import { Badge } from "../../../components/Badge";
import { TicketEmailModal } from "../../../components/TicketEmailModal";

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
    <div className="pb-24">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-slate-400 mb-4">
        <Link href="/tickets" className="hover:text-slate-700">
          Escalations
        </Link>
        <span>/</span>
        <span className="text-slate-700 font-medium truncate max-w-xs">
          {loading ? "Loading..." : customerName}
        </span>
      </nav>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded p-8 text-center text-slate-500 text-sm">
          Loading escalation details...
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded text-sm">
          {error}
        </div>
      ) : detail ? (
        <div>
          {/* Header */}
          <div className="bg-white border border-slate-200 rounded p-5 mb-5">
            <div className="flex flex-wrap items-start justify-between gap-6">
              {/* Left: identity */}
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 mb-2 flex-wrap">
                  <h1 className="text-xl font-bold text-slate-900">{customerName}</h1>
                  <Badge type="ticketStatus" value={detail.ticket.status} />
                  <span className={`text-xs font-medium px-2 py-0.5 rounded border ${
                    detail.ticket.priority === "high"
                      ? "bg-red-50 border-red-200 text-red-700"
                      : detail.ticket.priority === "medium"
                      ? "bg-amber-50 border-amber-200 text-amber-700"
                      : "bg-slate-50 border-slate-200 text-slate-600"
                  }`}>
                    {detail.ticket.priority} priority
                  </span>
                </div>
                <div className="text-xs text-slate-500 font-mono space-y-0.5">
                  {detail.customer?.email && <div>{detail.customer.email}</div>}
                  <div className="text-slate-400">
                    Entity:{" "}
                    <Link href={`/entities/${detail.ticket.entityId}`} className="text-blue-600 hover:underline">
                      {detail.ticket.entityId}
                    </Link>
                  </div>
                  <div className="text-slate-400">Ticket ID: {detail.ticket.id}</div>
                  <div className="text-slate-400">Escalated: {formatDateTime(detail.ticket.createdAt)}</div>
                </div>
              </div>

              {/* Right: amount + actions */}
              <div className="flex flex-col items-end gap-3 shrink-0">
                {detail.event && (
                  <div className="text-right">
                    <div className="text-xs text-slate-500 mb-0.5">Amount at Risk</div>
                    <div className="text-2xl font-bold font-mono text-amber-700">
                      {formatCurrency(detail.event.amount, detail.event.currency)}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowEmailModal(true)}
                    className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                  >
                    Send Email
                  </button>
                  {detail.ticket.status !== "recovered" && (
                    <button
                      type="button"
                      disabled={resolving}
                      onClick={() => handleResolve("recovered")}
                      className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 font-medium"
                    >
                      Mark Recovered
                    </button>
                  )}
                  {detail.ticket.status !== "written_off" && (
                    <button
                      type="button"
                      disabled={resolving}
                      onClick={() => handleResolve("written_off")}
                      className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 font-medium"
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
                <div className="bg-white border border-slate-200 rounded p-4">
                  <h2 className="text-sm font-semibold text-slate-900 mb-3">Triggering Event</h2>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                    <div>
                      <span className="text-slate-500">Event Type: </span>
                      <span className="font-mono text-slate-800">{detail.event.eventType}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Amount: </span>
                      <span className="font-mono font-bold text-slate-900">
                        {formatCurrency(detail.event.amount, detail.event.currency)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Failure Cause: </span>
                      <span className="text-slate-800 font-medium">{detail.event.causeLabel || "N/A"}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Error Reason: </span>
                      <span className="font-mono text-slate-700">{detail.event.errorReason || "N/A"}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Ticket Reason: </span>
                      <span className="text-slate-800">{detail.ticket.reason}</span>
                    </div>
                    {detail.ticket.resolvedAt && (
                      <div>
                        <span className="text-slate-500">Resolved At: </span>
                        <span className="font-mono text-emerald-700">{formatDateTime(detail.ticket.resolvedAt)}</span>
                      </div>
                    )}
                  </div>
                  {detail.ticket.resolutionNotes && (
                    <div className="mt-3 pt-3 border-t border-slate-100 text-xs">
                      <span className="text-slate-500 block mb-1">Resolution Notes</span>
                      <div className="text-slate-700 whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded p-2">
                        {detail.ticket.resolutionNotes}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Activity & notes */}
              <div className="bg-white border border-slate-200 rounded p-4">
                <h2 className="text-sm font-semibold text-slate-900 mb-3">
                  Activity & Internal Notes
                  <span className="ml-2 text-xs font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                    {notes.length}
                  </span>
                </h2>

                {notes.length === 0 ? (
                  <div className="text-xs text-slate-400 italic py-4 text-center">No notes recorded yet.</div>
                ) : (
                  <div className="space-y-2 mb-4">
                    {notes.map((note) => (
                      <div
                        key={note.id}
                        className={`p-3 rounded border text-xs ${
                          note.type === "email_sent"
                            ? "bg-blue-50 border-blue-200"
                            : note.type === "status_change"
                            ? "bg-slate-50 border-slate-200"
                            : "bg-amber-50 border-amber-200"
                        }`}
                      >
                        <div className="flex justify-between items-center text-[11px] text-slate-500 mb-1">
                          <span className="font-semibold text-slate-700">{note.author}</span>
                          <span className="font-mono">{formatDateTime(note.createdAt)}</span>
                        </div>
                        <div className="text-slate-800 whitespace-pre-wrap">{note.content}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add note form */}
                <form onSubmit={handleAddNote} className="pt-3 border-t border-slate-200 space-y-2">
                  <div className="text-xs font-semibold text-slate-700">Add Internal Note</div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Agent name..."
                      value={noteAuthor}
                      onChange={(e) => setNoteAuthor(e.target.value)}
                      className="px-2.5 py-1.5 border border-slate-300 rounded text-xs w-1/3 focus:outline-hidden focus:border-blue-500"
                    />
                    <input
                      type="text"
                      placeholder="Type note or call summary..."
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded text-xs focus:outline-hidden focus:border-blue-500"
                    />
                    <button
                      type="submit"
                      disabled={submittingNote || !newNote.trim()}
                      className="px-3 py-1.5 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-50 text-xs font-medium whitespace-nowrap"
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
                <div className="bg-white border border-slate-200 rounded p-4">
                  <h2 className="text-sm font-semibold text-slate-900 mb-3">Customer Profile</h2>
                  <div className="space-y-2 text-xs">
                    <div className="font-semibold text-slate-900 text-sm">{detail.customer.name}</div>
                    <div className="font-mono text-slate-600">{detail.customer.email}</div>
                    {detail.customer.phone && (
                      <div className="font-mono text-slate-600">{detail.customer.phone}</div>
                    )}
                    <div className="pt-2 space-y-1.5 border-t border-slate-100">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Risk Tier</span>
                        <Badge type="riskTier" value={detail.customer.riskTier} />
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Lifetime Value</span>
                        <span className="font-mono font-medium text-slate-800">
                          {formatCurrency(detail.customer.lifetimeValue)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">DNC Flag</span>
                        <span className={detail.customer.dncFlag ? "text-red-700 font-bold" : "text-slate-600"}>
                          {detail.customer.dncFlag ? "Yes" : "No"}
                        </span>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-slate-100">
                      <Link
                        href={`/entities/${detail.ticket.entityId}`}
                        className="text-blue-600 hover:underline text-xs font-medium"
                      >
                        View Entity Audit Trail →
                      </Link>
                    </div>
                  </div>
                </div>
              )}

              {/* Ticket metadata */}
              <div className="bg-white border border-slate-200 rounded p-4">
                <h2 className="text-sm font-semibold text-slate-900 mb-3">Ticket Details</h2>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Status</span>
                    <Badge type="ticketStatus" value={detail.ticket.status} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Priority</span>
                    <span className={`font-medium ${
                      detail.ticket.priority === "high" ? "text-red-700" :
                      detail.ticket.priority === "medium" ? "text-amber-700" : "text-slate-700"
                    }`}>
                      {detail.ticket.priority}
                    </span>
                  </div>
                  {detail.ticket.assignedTo && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Assigned To</span>
                      <span className="text-slate-800">{detail.ticket.assignedTo}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-500">Notes Count</span>
                    <span className="font-mono text-slate-800">{notes.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Created</span>
                    <span className="font-mono text-slate-700">{formatDateTime(detail.ticket.createdAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Updated</span>
                    <span className="font-mono text-slate-700">{formatDateTime(detail.ticket.updatedAt)}</span>
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
