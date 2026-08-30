"use client";

import { useState, useEffect } from "react";
import { formatCurrency, formatDateTime } from "../../lib/formatters";
import {
  listTickets,
  getTicketStats,
  getTicket,
  addTicketNote,
  resolveTicket,
  sendTicketEmail,
} from "../../lib/api";
import { TicketItem, TicketStats, TicketDetailResponse } from "../../types";
import { Badge } from "../../components/Badge";
import { TicketEmailModal } from "../../components/TicketEmailModal";

export default function TicketsPage() {
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketDetail, setTicketDetail] = useState<TicketDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("open");
  const [search, setSearch] = useState<string>("");

  const [newNote, setNewNote] = useState("");
  const [noteAuthor, setNoteAuthor] = useState("Agent Sarah");
  const [submittingNote, setSubmittingNote] = useState(false);

  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [includePaymentLink, setIncludePaymentLink] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatusMsg, setEmailStatusMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const [resolving, setResolving] = useState(false);

  const fetchAll = async () => {
    try {
      setLoading(true);
      const [statsData, ticketsData] = await Promise.all([
        getTicketStats(),
        listTickets({ status: activeTab, search: search || undefined }),
      ]);
      setStats(statsData);
      setTickets(ticketsData.items);

      if (ticketsData.items.length > 0) {
        if (!selectedTicketId || !ticketsData.items.some((t) => t.id === selectedTicketId)) {
          setSelectedTicketId(ticketsData.items[0].id);
        }
      } else {
        setSelectedTicketId(null);
        setTicketDetail(null);
      }
    } catch (err) {
      console.error("Failed to load tickets:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, [activeTab]);

  useEffect(() => {
    if (!selectedTicketId) {
      setTicketDetail(null);
      return;
    }
    setDetailLoading(true);
    getTicket(selectedTicketId)
      .then((detail) => {
        setTicketDetail(detail);
        if (detail.customer) {
          setEmailSubject(`Update regarding your reference ${detail.ticket.entityId}`);
          setEmailMessage(
            `Hi ${detail.customer.name},\n\nWe are following up regarding the pending balance of ${formatCurrency(detail.event?.amount ?? 0)}. Please let us know if you need assistance completing this payment.\n\nBest regards,\nRazorRecovery Support`
          );
        }
      })
      .catch((err) => {
        console.error("Failed to load ticket detail:", err);
      })
      .finally(() => {
        setDetailLoading(false);
      });
  }, [selectedTicketId]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchAll();
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicketId || !newNote.trim()) return;

    try {
      setSubmittingNote(true);
      await addTicketNote(selectedTicketId, {
        author: noteAuthor,
        content: newNote.trim(),
        type: "agent_note",
      });
      setNewNote("");
      const detail = await getTicket(selectedTicketId);
      setTicketDetail(detail);
      await fetchAll();
    } catch (err) {
      console.error("Failed to add note:", err);
    } finally {
      setSubmittingNote(false);
    }
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicketId || !emailSubject || !emailMessage) return;

    try {
      setSendingEmail(true);
      setEmailStatusMsg(null);
      const res = await sendTicketEmail(selectedTicketId, {
        subject: emailSubject,
        message: emailMessage,
        includePaymentLink,
        agentName: noteAuthor,
      });

      setEmailStatusMsg({
        text: `Email sent successfully.${res.paymentUrl ? ` Payment link: ${res.paymentUrl}` : ""}`,
        type: "success",
      });

      const detail = await getTicket(selectedTicketId);
      setTicketDetail(detail);
    } catch (err: any) {
      setEmailStatusMsg({
        text: err?.response?.data?.error || "Failed to send email.",
        type: "error",
      });
    } finally {
      setSendingEmail(false);
    }
  };

  const handleResolve = async (status: "recovered" | "written_off" | "resolved" | "open") => {
    if (!selectedTicketId) return;

    try {
      setResolving(true);
      await resolveTicket(selectedTicketId, {
        status,
        agentName: noteAuthor,
        resolutionNotes: `Status changed to ${status} by ${noteAuthor}`,
        recoveredAmount: status === "recovered" ? ticketDetail?.event?.amount : undefined,
      });

      await fetchAll();
      const detail = await getTicket(selectedTicketId);
      setTicketDetail(detail);
    } catch (err) {
      console.error("Failed to update status:", err);
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Human Escalation Workspace</h1>
        <p className="text-sm text-slate-500">
          Manage escalated failure cases, view customer contact details, add notes, and send direct outreach emails.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded p-4">
          <div className="text-xs text-slate-500">Open Escalations</div>
          <div className="text-xl font-bold text-slate-900 mt-1">{stats?.openCount ?? 0}</div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-4">
          <div className="text-xs text-slate-500">Amount Under Escalation</div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1">
            {formatCurrency(stats?.totalAtRisk ?? 0)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-4">
          <div className="text-xs text-slate-500">Recovered by Agents</div>
          <div className="text-xl font-bold font-mono text-emerald-700 mt-1">
            {formatCurrency(stats?.totalRecovered ?? 0)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-4">
          <div className="text-xs text-slate-500">Written Off Cases</div>
          <div className="text-xl font-bold text-slate-900 mt-1">{stats?.writtenOffCount ?? stats?.resolvedCount ?? 0}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded p-3">
        <div className="flex items-center gap-2">
          {[
            { id: "open", label: "Open" },
            { id: "recovered", label: "Recovered" },
            { id: "written_off", label: "Written Off" },
            { id: "all", label: "All" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1 text-xs rounded font-medium border ${
                activeTab === tab.id
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search customer, email, entity..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-xs px-3 py-1.5 border border-slate-300 rounded w-64 focus:outline-hidden focus:border-blue-500"
          />
          <button
            type="submit"
            className="text-xs bg-slate-800 text-white px-3 py-1.5 rounded hover:bg-slate-700"
          >
            Search
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded flex flex-col max-h-[650px] overflow-hidden">
          <div className="p-3 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
            Tickets ({tickets.length})
          </div>

          <div className="divide-y divide-slate-200 overflow-y-auto flex-1">
            {loading ? (
              <div className="p-6 text-center text-xs text-slate-500">Loading tickets...</div>
            ) : tickets.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">No tickets found.</div>
            ) : (
              tickets.map((t) => {
                const isSelected = t.id === selectedTicketId;
                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTicketId(t.id)}
                    className={`p-3 cursor-pointer text-xs ${
                      isSelected ? "bg-blue-50 font-medium" : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-slate-900">{t.customer?.name || "Customer"}</span>
                      <Badge type="ticketStatus" value={t.status} />
                    </div>
                    <div className="text-slate-500 truncate mb-1">{t.customer?.email || t.entityId}</div>
                    <div className="text-slate-600 mb-1">Reason: {t.reason}</div>
                    <div className="flex justify-between items-center text-slate-500 pt-1">
                      <span className="font-semibold font-mono text-slate-900">
                        {formatCurrency(t.event?.amount ?? 0)}
                      </span>
                      <span>{t.notesCount} note(s)</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded flex flex-col max-h-[650px] overflow-hidden">
          {detailLoading ? (
            <div className="p-12 text-center text-xs text-slate-500">Loading ticket details...</div>
          ) : !ticketDetail ? (
            <div className="p-12 text-center text-xs text-slate-400">Select a ticket to view details</div>
          ) : (
            <div className="flex flex-col h-full overflow-hidden">
              <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">{ticketDetail.ticket.entityId}</span>
                    <Badge type="ticketStatus" value={ticketDetail.ticket.status} />
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Escalated {formatDateTime(ticketDetail.ticket.createdAt)}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowEmailModal(true)}
                    className="px-2.5 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                  >
                    Send Email
                  </button>

                  {ticketDetail.ticket.status !== "recovered" && (
                    <button
                      type="button"
                      disabled={resolving}
                      onClick={() => handleResolve("recovered")}
                      className="px-2.5 py-1.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 font-medium"
                    >
                      Mark Recovered
                    </button>
                  )}

                  {ticketDetail.ticket.status !== "written_off" && (
                    <button
                      type="button"
                      disabled={resolving}
                      onClick={() => handleResolve("written_off")}
                      className="px-2.5 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 font-medium"
                    >
                      Write Off
                    </button>
                  )}
                </div>
              </div>

              <div className="p-4 overflow-y-auto space-y-4 flex-1 text-xs">
                {ticketDetail.customer && (
                  <div className="bg-slate-50 border border-slate-200 rounded p-3 space-y-2">
                    <div className="font-bold text-slate-900">Customer Profile</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-slate-500">Name: </span>
                        <span className="text-slate-800 font-medium">{ticketDetail.customer.name}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Email: </span>
                        <span className="text-slate-800 font-mono">{ticketDetail.customer.email}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Phone: </span>
                        <span className="text-slate-800 font-mono">{ticketDetail.customer.phone || "N/A"}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Risk Tier: </span>
                        <Badge type="riskTier" value={ticketDetail.customer.riskTier} />
                      </div>
                      <div>
                        <span className="text-slate-500">Lifetime Value: </span>
                        <span className="text-slate-800 font-mono font-medium">
                          {formatCurrency(ticketDetail.customer.lifetimeValue)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">DNC Flag: </span>
                        <span className={ticketDetail.customer.dncFlag ? "text-red-700 font-bold" : "text-slate-700"}>
                          {ticketDetail.customer.dncFlag ? "Yes" : "No"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {ticketDetail.event && (
                  <div className="border border-slate-200 rounded p-3 space-y-1">
                    <div className="font-bold text-slate-900">Triggering Event</div>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <span className="text-slate-500">Type: </span>
                        <span className="text-slate-800 font-mono">{ticketDetail.event.eventType}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Amount: </span>
                        <span className="text-slate-800 font-mono font-bold">
                          {formatCurrency(ticketDetail.event.amount, ticketDetail.event.currency)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">Cause: </span>
                        <span className="text-slate-800 font-medium">{ticketDetail.event.causeLabel || "N/A"}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Error: </span>
                        <span className="text-slate-800 font-mono">{ticketDetail.event.errorReason || "N/A"}</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="font-bold text-slate-900">Activity & Internal Notes</div>
                  {(ticketDetail.ticket.notes || ticketDetail.notes || []).length === 0 ? (
                    <div className="text-slate-400 italic">No notes recorded yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {(ticketDetail.ticket.notes || ticketDetail.notes || []).map((note) => (
                        <div
                          key={note.id}
                          className={`p-2.5 rounded border ${
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
                </div>

                <form onSubmit={handleAddNote} className="space-y-2 pt-2 border-t border-slate-200">
                  <div className="font-bold text-slate-900">Add Internal Note</div>
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
                      className="px-2.5 py-1.5 border border-slate-300 rounded text-xs flex-1 focus:outline-hidden focus:border-blue-500"
                    />
                    <button
                      type="submit"
                      disabled={submittingNote || !newNote.trim()}
                      className="px-3 py-1.5 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-50 text-xs font-medium"
                    >
                      {submittingNote ? "Adding..." : "Add Note"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>

      {showEmailModal && ticketDetail && (
        <TicketEmailModal
          isOpen={showEmailModal}
          onClose={() => setShowEmailModal(false)}
          customerName={ticketDetail.customer?.name}
          customerEmail={ticketDetail.customer?.email}
          amount={ticketDetail.event?.amount}
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
