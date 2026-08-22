/**
 * AdminPanel.jsx
 * Exclusive Admin Panel for user email whitelisting, tab pageview telemetry, and live chat query audit logs.
 * Restricted to keshaveddy731@gmail.com and keshava.reddy@timesinternet.in
 */
import React, { useState, useEffect } from 'react';
import { 
  Users, UserPlus, Trash2, ShieldCheck, Activity, MessageSquare, 
  Search, RefreshCw, BarChart2, Eye, Key, CheckCircle, AlertCircle
} from 'lucide-react';
import Plotly from 'plotly.js-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';

import { 
  getAllowedUsers, addAllowedUser, removeAllowedUser, 
  getTelemetryStats, isAdminEmail 
} from '../services/telemetryService';

const Plot = createPlotlyComponent(Plotly);

export default function AdminPanel({ user, isDark }) {
  const [activeSubTab, setActiveSubTab] = useState('users'); // 'users' | 'telemetry' | 'chat_logs'
  const [allowedUsers, setAllowedUsers] = useState([]);
  const [newEmailInput, setNewEmailInput] = useState('');
  const [userMsg, setUserMsg] = useState(null);
  const [telemetry, setTelemetry] = useState({ totalTabViews: 0, tabViews: {}, userSessions: [], chatLogs: [] });
  const [chatSearch, setChatSearch] = useState('');

  const refreshData = () => {
    setAllowedUsers(getAllowedUsers());
    setTelemetry(getTelemetryStats());
  };

  useEffect(() => {
    refreshData();
  }, []);

  const handleAddUser = (e) => {
    e.preventDefault();
    if (!newEmailInput || !newEmailInput.trim()) return;
    const target = newEmailInput.trim();

    if (addAllowedUser(target)) {
      setUserMsg({ type: 'success', text: `Access successfully granted to ${target}` });
      setNewEmailInput('');
      refreshData();
    } else {
      setUserMsg({ type: 'error', text: `${target} is already on the allowed list.` });
    }
  };

  const handleRemoveUser = (emailToRemove) => {
    if (isAdminEmail(emailToRemove)) {
      setUserMsg({ type: 'error', text: "Cannot remove root administrator accounts." });
      return;
    }
    if (removeAllowedUser(emailToRemove)) {
      setUserMsg({ type: 'success', text: `Revoked access for ${emailToRemove}` });
      refreshData();
    }
  };

  const filteredChatLogs = telemetry.chatLogs.filter(log => {
    if (!chatSearch.trim()) return true;
    const term = chatSearch.toLowerCase();
    return (
      log.userEmail.toLowerCase().includes(term) ||
      log.query.toLowerCase().includes(term) ||
      log.engine.toLowerCase().includes(term)
    );
  });

  return (
    <div className="animate-in fade-in duration-300 max-w-6xl mx-auto py-6">
      
      {/* Admin Panel Header */}
      <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl p-6 shadow-sm mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-warm-border dark:border-dark-border pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/10 text-amber-accent rounded-xl">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">Admin Control & Telemetry Panel</h2>
                <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                  Restricted Admin
                </span>
              </div>
              <p className="text-xs text-warm-muted dark:text-dark-muted font-medium mt-0.5">
                Logged in as: <strong className="text-warm-text dark:text-dark-text">{user?.email}</strong>
              </p>
            </div>
          </div>

          <button
            onClick={refreshData}
            className="px-3 py-1.5 text-xs font-bold bg-warm-bg dark:bg-zinc-800 hover:bg-black/5 dark:hover:bg-white/5 border border-warm-border dark:border-zinc-700 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh Stats</span>
          </button>
        </div>

        {/* Sub-Navigation Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto">
          {[
            { id: 'users', label: 'User Access Whitelist', icon: Users, count: allowedUsers.length },
            { id: 'telemetry', label: 'Pageview & Session Analytics', icon: BarChart2, count: telemetry.totalTabViews },
            { id: 'chat_logs', label: 'Conversational Audit Log', icon: MessageSquare, count: telemetry.chatLogs.length }
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer border ${
                  isActive
                    ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                    : 'bg-warm-bg/60 dark:bg-zinc-800/60 hover:bg-warm-bg dark:hover:bg-zinc-800 border-warm-border dark:border-zinc-700 text-warm-muted dark:text-dark-muted'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
                <span className={`px-2 py-0.2 text-[10px] rounded-full font-black ${
                  isActive ? 'bg-white/20 text-white' : 'bg-black/10 dark:bg-white/10'
                }`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* User Feedback Alert */}
      {userMsg && (
        <div className={`mb-6 p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between animate-in fade-in duration-200 ${
          userMsg.type === 'success' 
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300' 
            : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
        }`}>
          <div className="flex items-center gap-2">
            {userMsg.type === 'success' ? <CheckCircle className="h-4 w-4 text-emerald-500" /> : <AlertCircle className="h-4 w-4 text-rose-500" />}
            <span>{userMsg.text}</span>
          </div>
          <button onClick={() => setUserMsg(null)} className="text-xs font-bold hover:underline cursor-pointer">Dismiss</button>
        </div>
      )}

      {/* SUB-VIEW 1: USER ACCESS WHITELIST MANAGEMENT */}
      {activeSubTab === 'users' && (
        <div className="space-y-6">
          {/* Add User Card */}
          <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl p-6 shadow-sm">
            <h3 className="text-base font-bold mb-1 flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-amber-accent" />
              <span>Grant New User Access</span>
            </h3>
            <p className="text-xs text-warm-muted dark:text-dark-muted mb-4">
              Enter a work email address to grant dashboard access. Users not listed here will be blocked at login.
            </p>

            <form onSubmit={handleAddUser} className="flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                placeholder="user.name@timesinternet.in"
                value={newEmailInput}
                onChange={(e) => setNewEmailInput(e.target.value)}
                className="flex-1 text-xs p-3 rounded-xl border border-warm-border dark:border-zinc-700 bg-warm-bg dark:bg-zinc-900 font-medium focus:outline-hidden focus:ring-2 focus:ring-amber-500/50"
                required
              />
              <button
                type="submit"
                className="px-5 py-3 font-bold text-xs bg-amber-500 hover:bg-amber-600 text-white rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <UserPlus className="h-4 w-4" />
                <span>Grant Access</span>
              </button>
            </form>
          </div>

          {/* Allowed Users List Table */}
          <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Users className="h-4 w-4 text-amber-accent" />
                <span>Authorized Users Whitelist</span>
              </h3>
              <span className="text-xs text-warm-muted dark:text-dark-muted font-semibold">
                Total Allowed: {allowedUsers.length} Users
              </span>
            </div>

            <div className="overflow-x-auto border border-warm-border dark:border-zinc-800 rounded-xl">
              <table className="w-full text-xs text-left">
                <thead className="bg-amber-100/60 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 font-extrabold border-b border-amber-300 dark:border-amber-800">
                  <tr>
                    <th className="p-3">User Email</th>
                    <th className="p-3">Role Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-warm-border/40 dark:divide-zinc-800 bg-white dark:bg-zinc-900 font-medium">
                  {allowedUsers.map((email, idx) => {
                    const isAdmin = isAdminEmail(email);
                    return (
                      <tr key={idx} className="hover:bg-black/5 dark:hover:bg-white/5">
                        <td className="p-3 font-bold text-warm-text dark:text-dark-text flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                          <span>{email}</span>
                        </td>
                        <td className="p-3">
                          {isAdmin ? (
                            <span className="px-2.5 py-0.5 text-[10px] font-extrabold rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                              👑 Administrator
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/30">
                              👤 Whitelisted User
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {isAdmin ? (
                            <span className="text-[11px] text-warm-muted dark:text-dark-muted italic">Root Admin</span>
                          ) : (
                            <button
                              onClick={() => handleRemoveUser(email)}
                              className="px-2.5 py-1 text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all flex items-center gap-1 ml-auto cursor-pointer"
                              title="Revoke access for this user"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>Revoke Access</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-VIEW 2: PAGEVIEW & SESSION TELEMETRY */}
      {activeSubTab === 'telemetry' && (
        <div className="space-y-6">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border p-5 rounded-2xl shadow-xs">
              <div className="text-xs font-bold text-warm-muted dark:text-dark-muted uppercase tracking-wider mb-1">Total Tab Pageviews</div>
              <div className="text-2xl font-black text-amber-accent">{telemetry.totalTabViews.toLocaleString()}</div>
              <div className="text-[11px] text-warm-muted dark:text-dark-muted mt-1">Across all dashboard sections</div>
            </div>

            <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border p-5 rounded-2xl shadow-xs">
              <div className="text-xs font-bold text-warm-muted dark:text-dark-muted uppercase tracking-wider mb-1">Active User Sessions</div>
              <div className="text-2xl font-black text-amber-accent">{telemetry.userSessions.length}</div>
              <div className="text-[11px] text-warm-muted dark:text-dark-muted mt-1">Authenticated user profiles</div>
            </div>

            <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border p-5 rounded-2xl shadow-xs">
              <div className="text-xs font-bold text-warm-muted dark:text-dark-muted uppercase tracking-wider mb-1">Total Chat Queries Asked</div>
              <div className="text-2xl font-black text-amber-accent">{telemetry.chatLogs.length}</div>
              <div className="text-[11px] text-warm-muted dark:text-dark-muted mt-1">Conversational Assistant logs</div>
            </div>
          </div>

          {/* Pageview Chart */}
          <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl p-6 shadow-sm">
            <h3 className="text-base font-bold mb-4 flex items-center gap-2">
              <Eye className="h-4 w-4 text-amber-accent" />
              <span>Pageviews Breakdown by Dashboard Tab</span>
            </h3>

            <div className="w-full h-[260px]">
              <Plot
                data={[
                  {
                    x: Object.keys(telemetry.tabViews),
                    y: Object.values(telemetry.tabViews),
                    type: 'bar',
                    marker: { color: ['#F59E0B', '#3B82F6', '#10B981', '#6366F1', '#EC4899'] },
                    text: Object.values(telemetry.tabViews).map(v => `${v} views`),
                    textposition: 'auto'
                  }
                ]}
                layout={{
                  autosize: true,
                  margin: { l: 40, r: 20, t: 20, b: 50 },
                  paper_bgcolor: 'transparent',
                  plot_bgcolor: 'transparent',
                  xaxis: { tickfont: { size: 11, color: isDark ? '#cbd5e1' : '#475569' } },
                  yaxis: { tickfont: { size: 11, color: isDark ? '#cbd5e1' : '#475569' }, showgrid: true, gridcolor: 'rgba(200,200,200,0.1)' }
                }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%', height: '100%' }}
              />
            </div>
          </div>

          {/* User Session History Table */}
          <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl p-6 shadow-sm">
            <h3 className="text-base font-bold mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-amber-accent" />
              <span>User Session Activity History</span>
            </h3>

            <div className="overflow-x-auto border border-warm-border dark:border-zinc-800 rounded-xl">
              <table className="w-full text-xs text-left">
                <thead className="bg-amber-100/60 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 font-extrabold border-b border-amber-300 dark:border-amber-800">
                  <tr>
                    <th className="p-3">User Email</th>
                    <th className="p-3">Role</th>
                    <th className="p-3 text-right">Total Visits</th>
                    <th className="p-3 text-right">Last Active Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-warm-border/40 dark:divide-zinc-800 bg-white dark:bg-zinc-900 font-medium">
                  {telemetry.userSessions.map((sess, i) => (
                    <tr key={i} className="hover:bg-black/5 dark:hover:bg-white/5">
                      <td className="p-3 font-bold text-amber-accent">{sess.email}</td>
                      <td className="p-3">{sess.role}</td>
                      <td className="p-3 text-right font-bold">{sess.totalVisits}</td>
                      <td className="p-3 text-right font-mono text-[11px]">{sess.lastActive}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-VIEW 3: CONVERSATIONAL CHATBOT AUDIT LOG */}
      {activeSubTab === 'chat_logs' && (
        <div className="bg-white dark:bg-dark-card border border-warm-border dark:border-dark-border rounded-2xl p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-base font-bold flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-amber-accent" />
                <span>Conversational Analytics Chat Audit Feed</span>
              </h3>
              <p className="text-xs text-warm-muted dark:text-dark-muted">
                Track every natural language query submitted by team members
              </p>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-2.5 text-warm-muted dark:text-dark-muted" />
              <input
                type="text"
                placeholder="Search user, query, or engine..."
                value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
                className="pl-9 pr-3 py-2 rounded-xl border border-warm-border dark:border-zinc-700 bg-warm-bg dark:bg-zinc-900 text-xs font-medium focus:outline-hidden focus:ring-2 focus:ring-amber-500/50 w-full sm:w-64"
              />
            </div>
          </div>

          {/* Audit Logs Table */}
          <div className="overflow-x-auto border border-warm-border dark:border-zinc-800 rounded-xl">
            <table className="w-full text-xs text-left">
              <thead className="bg-amber-100/60 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 font-extrabold border-b border-amber-300 dark:border-amber-800">
                <tr>
                  <th className="p-3">Timestamp</th>
                  <th className="p-3">User Email</th>
                  <th className="p-3">Query Asked</th>
                  <th className="p-3">Engine Used</th>
                  <th className="p-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-warm-border/40 dark:divide-zinc-800 bg-white dark:bg-zinc-900 font-medium">
                {filteredChatLogs.length > 0 ? (
                  filteredChatLogs.map((log, i) => (
                    <tr key={i} className="hover:bg-black/5 dark:hover:bg-white/5">
                      <td className="p-3 font-mono text-[11px] text-warm-muted dark:text-dark-muted whitespace-nowrap">{log.timestamp}</td>
                      <td className="p-3 font-bold text-amber-accent whitespace-nowrap">{log.userEmail}</td>
                      <td className="p-3 font-medium text-warm-text dark:text-dark-text max-w-xs truncate" title={log.query}>
                        "{log.query}"
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                          log.engine.includes('Gemini') 
                            ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30' 
                            : 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30'
                        }`}>
                          {log.engine}
                        </span>
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <span className="px-2 py-0.5 text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 rounded-full border border-emerald-500/20">
                          {log.status}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-warm-muted dark:text-dark-muted italic">
                      No chat audit logs match your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
