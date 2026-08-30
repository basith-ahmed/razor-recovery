"use client";

import { useEffect, useState } from "react";
import {
  listTickets,
  getTicketStats,
  getTicket,
  addTicketNote,
  sendTicketEmail,
  resolveTicket,
} from "../../lib/api";
import {
  TicketItem,
  TicketStats,
  TicketDetailResponse,
} from "../../types";

export default function TicketsPage() {
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketDetail, setTicketDetail] = useState<TicketDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("open");
  const [search, setSearch] = useState<string>("");

  // Notes state
  const [newNote, setNewNote] = useState("");
  const [noteAuthor, setNoteAuthor] = useState("Agent Sarah");
  const [submittingNote, setSubmittingNote] = useState(false);

  // Email modal state
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [includePaymentLink, setIncludePaymentLink] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatusMsg, setEmailStatusMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Action state
  const [resolving, setResolving] = useState(false);

  // Load stats and tickets
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

  // Load ticket details when selectedTicketId changes
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
            `Hi ${detail.customer.name},\n\nWe are following up regarding the pending balance of ₹${detail.event?.amount ?? 0}. Please let us know if you need assistance completing this payment.\n\nBest regards,\nRazorRecovery Support`
          );
        }
      })
      .catch((err) => console.error("Failed to fetch ticket detail:", err))
      .finally(() => setDetailLoading(false));
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
      });
      setNewNote("");
      const detail = await getTicket(selectedTicketId);
      setTicketDetail(detail);
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

      setTimeout(() => {
        setShowEmailModal(false);
        setEmailStatusMsg(null);
      }, 1500);
    } catch (err: any) {
      setEmailStatusMsg({
        text: err?.response?.data?.error || "Failed to send email.",
        type: "error",
      });
    } finally {
      setSendingEmail(false);
    }
  };

  const handleResolve = async (status: "recovered" | "written_off") => {
    if (!selectedTicketId) return;
    const confirmMsg =
      status === "recovered"
        ? "Mark this ticket as RECOVERED? This records recovered revenue in the financial ledger and sets workflow state to RECOVERED."
        : "Mark this ticket as WRITTEN OFF? This records the uncollectible loss in the financial ledger and sets workflow state to WRITTEN_OFF.";

    if (!window.confirm(confirmMsg)) return;

    try {
      setResolving(true);
      await resolveTicket(selectedTicketId, {
        status,
        resolutionNotes: `${status === "recovered" ? "Recovered" : "Written off"} by ${noteAuthor}`,
        agentName: noteAuthor,
      });

      await fetchAll();
      if (selectedTicketId) {
        const detail = await getTicket(selectedTicketId);
        setTicketDetail(detail);
      }
    } catch (err) {
      console.error("Failed to resolve ticket:", err);
    } finally {
      setResolving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return <span className="bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded font-medium">Open</span>;
      case "recovered":
        return <span className="bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded font-medium">Recovered</span>;
      case "written_off":
      case "resolved":
        return <span className="bg-rose-100 text-rose-800 text-xs px-2 py-0.5 rounded font-medium">Written Off</span>;
      default:
        return <span className="bg-slate-100 text-slate-800 text-xs px-2 py-0.5 rounded font-medium">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-xl font-bold text-slate-900">Human Escalation Workspace</h1>
        <p className="text-sm text-slate-500">
          Manage escalated failure cases, view customer contact details, add notes, and send direct outreach emails.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded p-4">
          <div className="text-xs text-slate-500">Open Escalations</div>
          <div className="text-xl font-bold text-slate-900 mt-1">{stats?.openCount ?? 0}</div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-4">
          <div className="text-xs text-slate-500">Amount Under Escalation</div>
          <div className="text-xl font-bold text-slate-900 mt-1">
            ₹{(stats?.totalAtRisk ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-4">
          <div className="text-xs text-slate-500">Recovered by Agents</div>
          <div className="text-xl font-bold text-emerald-700 mt-1">
            ₹{(stats?.totalRecovered ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-4">
          <div className="text-xs text-slate-500">Written Off Cases</div>
          <div className="text-xl font-bold text-slate-900 mt-1">{stats?.writtenOffCount ?? stats?.resolvedCount ?? 0}</div>
        </div>
      </div>

      {/* Controls Bar */}
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
            className="text-xs px-3 py-1.5 border border-slate-300 rounded w-64 focus:outline-none focus:border-slate-500"
          />
          <button
            type="submit"
            className="text-xs bg-slate-800 text-white px-3 py-1.5 rounded hover:bg-slate-700"
          >
            Search
          </button>
        </form>
      </div>

      {/* Master-Detail Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Tickets List */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded flex flex-col max-h-[650px] overflow-hidden">
          <div className="p-3 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
            Tickets ({tickets.length})
          </div>

          <div className="divide-y divide-slate-100 overflow-y-auto flex-1">
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
                      isSelected ? "bg-slate-100 font-medium" : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-slate-900">{t.customer?.name || "Customer"}</span>
                      {getStatusBadge(t.status)}
                    </div>
                    <div className="text-slate-500 truncate mb-1">{t.customer?.email || t.entityId}</div>
                    <div className="text-slate-600 mb-1">Reason: {t.reason}</div>
                    <div className="flex justify-between items-center text-slate-500 pt-1">
                      <span className="font-semibold text-slate-900">
                        ₹{(t.event?.amount ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </span>
                      <span>{t.notesCount} note(s)</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Ticket Detail */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded flex flex-col max-h-[650px] overflow-hidden">
          {detailLoading ? (
            <div className="p-8 text-center text-xs text-slate-500">Loading details...</div>
          ) : !ticketDetail ? (
            <div className="p-8 text-center text-xs text-slate-500">Select a ticket to view details.</div>
          ) : (
            <div className="flex flex-col h-full overflow-y-auto">
              {/* Header & Actions */}
              <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap justify-between items-center gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">{ticketDetail.ticket.entityId}</span>
                    {getStatusBadge(ticketDetail.ticket.status)}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Amount: ₹{(ticketDetail.event?.amount ?? 0).toLocaleString("en-IN")}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowEmailModal(true)}
                    className="text-xs bg-white border border-slate-300 text-slate-800 px-3 py-1.5 rounded hover:bg-slate-50"
                  >
                    Send Email
                  </button>

                  {ticketDetail.ticket.status === "open" && (
                    <>
                      <button
                        onClick={() => handleResolve("recovered")}
                        disabled={resolving}
                        className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded hover:bg-emerald-700"
                      >
                        Mark Recovered
                      </button>

                      <button
                        onClick={() => handleResolve("written_off")}
                        disabled={resolving}
                        className="text-xs bg-slate-600 text-white px-3 py-1.5 rounded hover:bg-slate-700"
                      >
                        Write Off
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Customer & Case Info */}
              <div className="p-4 border-b border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="border border-slate-200 rounded p-3 space-y-1 bg-white">
                  <div className="font-bold text-slate-800 mb-1">Customer Information</div>
                  <div><span className="text-slate-500">Name:</span> {ticketDetail.customer?.name || "N/A"}</div>
                  <div>
                    <span className="text-slate-500">Email:</span>{" "}
                    <a href={`mailto:${ticketDetail.customer?.email}`} className="text-blue-600 hover:underline">
                      {ticketDetail.customer?.email || "N/A"}
                    </a>
                  </div>
                  <div><span className="text-slate-500">Phone:</span> {ticketDetail.customer?.phone || "N/A"}</div>
                  <div>
                    <span className="text-slate-500">Lifetime Value:</span> ₹{(ticketDetail.customer?.lifetimeValue ?? 0).toLocaleString("en-IN")}
                  </div>
                </div>

                <div className="border border-slate-200 rounded p-3 space-y-1 bg-white">
                  <div className="font-bold text-slate-800 mb-1">Escalation Context</div>
                  <div><span className="text-slate-500">Diagnosed Cause:</span> {ticketDetail.event?.causeLabel || "N/A"}</div>
                  <div><span className="text-slate-500">Trigger:</span> {ticketDetail.ticket.reason}</div>
                  <div><span className="text-slate-500">Workflow State:</span> {ticketDetail.workflowState || "ESCALATED"}</div>
                  <div><span className="text-slate-500">Created:</span> {new Date(ticketDetail.ticket.createdAt).toLocaleString()}</div>
                </div>
              </div>

              {/* Notes Thread */}
              <div className="p-4 flex-1 space-y-3">
                <div className="text-xs font-bold text-slate-800">
                  Notes & Outreach Log ({ticketDetail.ticket.notes.length})
                </div>

                <div className="space-y-2">
                  {ticketDetail.ticket.notes.length === 0 ? (
                    <div className="text-xs text-slate-400">No notes yet.</div>
                  ) : (
                    ticketDetail.ticket.notes.map((n) => (
                      <div key={n.id} className="border border-slate-200 rounded p-2.5 text-xs bg-white">
                        <div className="flex justify-between text-slate-500 text-[11px] mb-1">
                          <span className="font-semibold text-slate-700">{n.author} ({n.type})</span>
                          <span>{new Date(n.createdAt).toLocaleString()}</span>
                        </div>
                        <div className="whitespace-pre-wrap text-slate-800">{n.content}</div>
                      </div>
                    ))
                  )}
                </div>

                {/* Add Note Form */}
                <form onSubmit={handleAddNote} className="pt-2 border-t border-slate-200 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Author:</span>
                    <input
                      type="text"
                      value={noteAuthor}
                      onChange={(e) => setNoteAuthor(e.target.value)}
                      className="text-xs px-2 py-1 border border-slate-300 rounded"
                    />
                  </div>
                  <textarea
                    rows={2}
                    placeholder="Enter internal note..."
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    className="w-full text-xs p-2 border border-slate-300 rounded focus:outline-none focus:border-slate-500"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={submittingNote || !newNote.trim()}
                      className="text-xs bg-slate-800 text-white px-3 py-1.5 rounded hover:bg-slate-700 disabled:opacity-50"
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

      {/* Email Modal */}
      {showEmailModal && ticketDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded border border-slate-300 max-w-md w-full p-5 space-y-3 text-xs">
            <div className="flex justify-between items-center border-b border-slate-200 pb-2">
              <h3 className="font-bold text-slate-900 text-sm">Send Email Outreach</h3>
              <button
                type="button"
                onClick={() => setShowEmailModal(false)}
                className="text-slate-500 hover:text-slate-800 text-sm"
              >
                ✕
              </button>
            </div>

            {emailStatusMsg && (
              <div
                className={`p-2 rounded ${
                  emailStatusMsg.type === "success"
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                    : "bg-rose-50 text-rose-800 border border-rose-200"
                }`}
              >
                {emailStatusMsg.text}
              </div>
            )}

            <form onSubmit={handleSendEmail} className="space-y-3">
              <div>
                <label className="block text-slate-600 mb-1 font-medium">To:</label>
                <input
                  type="text"
                  disabled
                  value={`${ticketDetail.customer?.name} <${ticketDetail.customer?.email}>`}
                  className="w-full px-2 py-1.5 bg-slate-100 border border-slate-200 rounded text-slate-600"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-medium">Subject:</label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded focus:outline-none focus:border-slate-500"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-medium">Message:</label>
                <textarea
                  rows={5}
                  value={emailMessage}
                  onChange={(e) => setEmailMessage(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded focus:outline-none focus:border-slate-500"
                />
              </div>

              <div className="flex items-center gap-2 border border-slate-200 p-2 rounded bg-slate-50">
                <input
                  type="checkbox"
                  id="includeLink"
                  checked={includePaymentLink}
                  onChange={(e) => setIncludePaymentLink(e.target.checked)}
                />
                <label htmlFor="includeLink" className="text-slate-700 cursor-pointer">
                  Attach Razorpay recovery payment link (₹{(ticketDetail.event?.amount ?? 0).toLocaleString("en-IN")})
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowEmailModal(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sendingEmail}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {sendingEmail ? "Sending..." : "Send Email"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
