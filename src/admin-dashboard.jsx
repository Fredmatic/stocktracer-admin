import { useState, useEffect, useMemo } from "react"

const SUPABASE_URL = "https://mzdqovkioekyrqhzppwu.supabase.co"
const SUPABASE_KEY = "sb_publishable_2JPp70XbE7Ib7pNPApuESg_lcR0IOzC"
const ADMIN_EMAIL = "fssaazi46@gmail.com"

async function sbFetch(path, opts = {}) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        ...opts,
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${opts.token || SUPABASE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
            ...(opts.headers || {}),
        },
    })
    if (!r.ok) throw new Error(await r.text())
    return r.json().catch(() => null)
}

async function sbAuth(email, password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    })
    const data = await r.json()
    if (!r.ok) throw new Error(data.error_description || data.msg || "Login failed")
    return data
}

async function sbUpdate(path, body, token) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method: "PATCH",
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
        },
        body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(await r.text())
    return r.json().catch(() => null)
}

function daysLeft(trialEndsAt) {
    if (!trialEndsAt) return 0
    return Math.max(0, Math.ceil((new Date(trialEndsAt) - new Date()) / 86400000))
}

function StatusBadge({ status, trialEndsAt }) {
    const left = daysLeft(trialEndsAt)
    const cfg = {
        active: { cls: "badge badge-success", label: "Active" },
        trial: {
            cls: left <= 3 ? "badge badge-danger" : "badge badge-warning",
            label: left === 0 ? "Trial ended" : `Trial · ${left}d left`
        },
        expired: { cls: "badge badge-danger", label: "Expired" },
        cancelled: { cls: "badge badge-muted", label: "Cancelled" },
    }[status] || { cls: "badge badge-muted", label: status }
    return <span className={cfg.cls}>{cfg.label}</span>
}

function MetricCard({ label, value, sub, variant }) {
    return (
        <div className={`metric-card ${variant ? `metric-card--${variant}` : ""}`}>
            <div className="metric-label">{label}</div>
            <div className="metric-value">{value}</div>
            {sub && <div className="metric-sub">{sub}</div>}
        </div>
    )
}

export default function AdminDashboard() {
    const [session, setSession] = useState(null)
    const [email, setEmail] = useState(ADMIN_EMAIL)
    const [password, setPassword] = useState("")
    const [loginErr, setLoginErr] = useState("")
    const [loginBusy, setLoginBusy] = useState(false)

    const [businesses, setBusinesses] = useState([])
    const [loading, setLoading] = useState(false)
    const [search, setSearch] = useState("")
    const [filterStatus, setFilterStatus] = useState("all")
    const [selected, setSelected] = useState(null)
    const [busyId, setBusyId] = useState(null)
    const [toast, setToast] = useState(null)

    function showToast(msg, type = "success") {
        setToast({ msg, type })
        setTimeout(() => setToast(null), 3000)
    }

    async function login(e) {
        e.preventDefault()
        setLoginBusy(true)
        setLoginErr("")
        try {
            const data = await sbAuth(email, password)
            setSession(data)
        } catch (err) {
            setLoginErr(err.message)
        } finally {
            setLoginBusy(false)
        }
    }

    async function loadBusinesses(token) {
        setLoading(true)
        try {
            const data = await sbFetch(
                "/businesses?select=id,name,type,owner_name,subscription_status,trial_ends_at,created_at&order=created_at.desc",
                { token }
            )
            const salesData = await sbFetch(
                "/sales?select=business_id,total_amount,created_at&is_refunded=eq.false",
                { token }
            ).catch(() => [])
            const staffData = await sbFetch(
                "/staff_users?select=business_id,id",
                { token }
            ).catch(() => [])

            const salesMap = {}
            const recentSalesMap = {}
            const cutoff = new Date(Date.now() - 30 * 86400000);
            (salesData || []).forEach((s) => {
                salesMap[s.business_id] = (salesMap[s.business_id] || 0) + Number(s.total_amount)
                if (new Date(s.created_at) > cutoff) {
                    recentSalesMap[s.business_id] = (recentSalesMap[s.business_id] || 0) + 1
                }
            })
            const staffMap = {};
            (staffData || []).forEach((s) => {
                staffMap[s.business_id] = (staffMap[s.business_id] || 0) + 1
            })

            setBusinesses((data || []).map((b) => ({
                ...b,
                totalSales: salesMap[b.id] || 0,
                salesLast30: recentSalesMap[b.id] || 0,
                staffCount: staffMap[b.id] || 0,
            })))
        } catch (err) {
            const msg = err.message || ''
            if (msg.includes('JWT expired') || msg.includes('PGRST303')) {
                showToast('Session expired — please sign in again', 'danger')
                setTimeout(() => setSession(null), 2000)
            } else {
                showToast('Failed to load: ' + msg, 'danger')
            }

        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (session) loadBusinesses(session.access_token)
    }, [session])

    async function setStatus(id, status) {
        setBusyId(id)
        try {
            const updates = { subscription_status: status }
            if (status === "trial") {
                updates.trial_ends_at = new Date(Date.now() + 14 * 86400000).toISOString()
            }
            await sbUpdate(`/businesses?id=eq.${id}`, updates, session.access_token)
            setBusinesses((prev) =>
                prev.map((b) => b.id === id ? { ...b, ...updates } : b)
            )
            if (selected?.id === id) setSelected((s) => ({ ...s, ...updates }))
            showToast(status === "active" ? "Account activated ✓" : status === "trial" ? "Reset to trial ✓" : "Account deactivated ✓")
        } catch (err) {
            const msg = err.message || ''
            if (msg.includes('JWT expired') || msg.includes('PGRST303')) {
                showToast('Session expired — please sign in again', 'danger')
                setTimeout(() => setSession(null), 2000)
            } else {
                showToast(msg, 'danger')
            }

        } finally {
            setBusyId(null)
        }
    }

    const filtered = useMemo(() => {
        return businesses.filter((b) => {
            const matchSearch = !search || b.name.toLowerCase().includes(search.toLowerCase()) || (b.owner_name || "").toLowerCase().includes(search.toLowerCase())
            const matchStatus = filterStatus === "all" || b.subscription_status === filterStatus ||
                (filterStatus === "expiring" && b.subscription_status === "trial" && daysLeft(b.trial_ends_at) <= 3 && daysLeft(b.trial_ends_at) > 0)
            return matchSearch && matchStatus
        })
    }, [businesses, search, filterStatus])

    const metrics = useMemo(() => ({
        total: businesses.length,
        active: businesses.filter((b) => b.subscription_status === "active").length,
        trial: businesses.filter((b) => b.subscription_status === "trial").length,
        expiring: businesses.filter((b) => b.subscription_status === "trial" && daysLeft(b.trial_ends_at) <= 3 && daysLeft(b.trial_ends_at) > 0).length,
        expired: businesses.filter((b) => b.subscription_status === "expired" || (b.subscription_status === "trial" && daysLeft(b.trial_ends_at) === 0)).length,
        totalRevenue: businesses.filter((b) => b.subscription_status === "active").length * 80000,
    }), [businesses])

    if (!session) {
        return (
            <>
                <style>{adminStyles}</style>
                <div className="admin-login-screen">
                    <div className="admin-login-box">
                        <div className="admin-login-header">
                            <div className="admin-logo">
                                <span className="admin-logo-mark">ST</span>
                            </div>
                            <h1 className="admin-login-title">StockTracer Admin</h1>
                            <p className="admin-login-sub">Owner access only</p>
                        </div>
                        <form onSubmit={login} className="admin-login-form">
                            <div className="field-group">
                                <label className="field-label">Email</label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className="admin-input"
                                />
                            </div>
                            <div className="field-group">
                                <label className="field-label">Password</label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    autoFocus
                                    className="admin-input"
                                />
                            </div>
                            {loginErr && <div className="admin-error">{loginErr}</div>}
                            <button type="submit" disabled={loginBusy} className="admin-btn-primary">
                                {loginBusy ? "Signing in…" : "Sign in"}
                            </button>
                        </form>
                    </div>
                </div>
            </>
        )
    }

    return (
        <>
            <style>{adminStyles}</style>
            <div className="admin-shell">

                {/* Toast */}
                {toast && (
                    <div className={`admin-toast admin-toast--${toast.type}`}>
                        {toast.msg}
                    </div>
                )}

                {/* Top nav */}
                <header className="admin-nav">
                    <div className="admin-nav-brand">
                        <span className="admin-logo-mark admin-logo-mark--sm">ST</span>
                        <span className="admin-nav-title">StockTracer Admin</span>
                    </div>
                    <div className="admin-nav-actions">
                        <button className="admin-btn-ghost" onClick={() => loadBusinesses(session.access_token)}>
                            ↻ Refresh
                        </button>
                        <button className="admin-btn-ghost admin-btn-ghost--muted" onClick={() => setSession(null)}>
                            Sign out
                        </button>
                    </div>
                </header>

                <main className="admin-main">

                    {/* Metric cards */}
                    <div className="metrics-grid">
                        <MetricCard label="Total shops" value={metrics.total} />
                        <MetricCard label="Active (paid)" value={metrics.active} variant="success" />
                        <MetricCard label="On trial" value={metrics.trial} variant="warning" />
                        <MetricCard label="Expiring soon" value={metrics.expiring} sub="≤ 3 days left" variant="danger" />
                        <MetricCard label="Expired" value={metrics.expired} variant="danger" />
                        <MetricCard
                            label="Est. MRR"
                            value={`UGX ${metrics.totalRevenue.toLocaleString()}`}
                            sub="active × 80k"
                            variant="accent"
                        />
                    </div>

                    {/* Search & filter */}
                    <div className="admin-toolbar">
                        <input
                            className="admin-input admin-search"
                            placeholder="Search by shop or owner name…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        <select
                            className="admin-input admin-select"
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                        >
                            <option value="all">All statuses</option>
                            <option value="active">Active</option>
                            <option value="trial">Trial</option>
                            <option value="expiring">Expiring soon</option>
                            <option value="expired">Expired</option>
                            <option value="cancelled">Cancelled</option>
                        </select>
                    </div>

                    {/* Table */}
                    {loading ? (
                        <div className="admin-empty">Loading businesses…</div>
                    ) : filtered.length === 0 ? (
                        <div className="admin-empty">No businesses match your filter.</div>
                    ) : (
                        <div className="admin-table-wrap">
                            <table className="admin-table">
                                <thead>
                                    <tr>
                                        <th>Shop</th>
                                        <th>Type</th>
                                        <th>Status</th>
                                        <th className="ta-right">Staff</th>
                                        <th className="ta-right">Sales 30d</th>
                                        <th className="ta-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map((b) => (
                                        <tr
                                            key={b.id}
                                            className={selected?.id === b.id ? "row-selected" : ""}
                                            onClick={() => setSelected(selected?.id === b.id ? null : b)}
                                        >
                                            <td>
                                                <div className="shop-name">{b.name}</div>
                                                {b.owner_name && <div className="shop-owner">{b.owner_name}</div>}
                                            </td>
                                            <td className="td-muted td-capitalize">{b.type}</td>
                                            <td><StatusBadge status={b.subscription_status} trialEndsAt={b.trial_ends_at} /></td>
                                            <td className="ta-right td-muted">{b.staffCount}</td>
                                            <td className="ta-right td-muted">{b.salesLast30}</td>
                                            <td className="ta-right" onClick={(e) => e.stopPropagation()}>
                                                <div className="row-actions">
                                                    {b.subscription_status !== "active" && (
                                                        <button
                                                            className="action-btn action-btn--success"
                                                            disabled={busyId === b.id}
                                                            onClick={() => setStatus(b.id, "active")}
                                                        >
                                                            {busyId === b.id ? "…" : "Activate"}
                                                        </button>
                                                    )}
                                                    {b.subscription_status === "active" && (
                                                        <button
                                                            className="action-btn action-btn--danger"
                                                            disabled={busyId === b.id}
                                                            onClick={() => setStatus(b.id, "expired")}
                                                        >
                                                            {busyId === b.id ? "…" : "Deactivate"}
                                                        </button>
                                                    )}
                                                    {b.subscription_status !== "trial" && (
                                                        <button
                                                            className="action-btn"
                                                            disabled={busyId === b.id}
                                                            onClick={() => setStatus(b.id, "trial")}
                                                        >
                                                            Trial
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Detail panel */}
                    {selected && (
                        <div className="detail-panel">
                            <div className="detail-header">
                                <div>
                                    <div className="detail-name">{selected.name}</div>
                                    <div className="detail-meta">
                                        {selected.type} · Created {new Date(selected.created_at).toLocaleDateString()}
                                        {selected.owner_name ? ` · ${selected.owner_name}` : ""}
                                    </div>
                                </div>
                                <button className="detail-close" onClick={() => setSelected(null)}>✕</button>
                            </div>
                            <div className="metrics-grid metrics-grid--sm">
                                <MetricCard label="Status" value={<StatusBadge status={selected.subscription_status} trialEndsAt={selected.trial_ends_at} />} />
                                <MetricCard
                                    label="Trial ends"
                                    value={selected.trial_ends_at ? new Date(selected.trial_ends_at).toLocaleDateString() : "N/A"}
                                    sub={selected.subscription_status === "trial" ? `${daysLeft(selected.trial_ends_at)} days left` : ""}
                                />
                                <MetricCard label="Staff" value={selected.staffCount} />
                                <MetricCard label="Sales (30d)" value={selected.salesLast30} />
                                <MetricCard label="Total revenue" value={`UGX ${selected.totalSales.toLocaleString()}`} variant="accent" />
                            </div>
                            <div className="detail-actions">
                                <button
                                    className="action-btn action-btn--success action-btn--lg"
                                    disabled={busyId === selected.id || selected.subscription_status === "active"}
                                    onClick={() => setStatus(selected.id, "active")}
                                >
                                    Activate account
                                </button>
                                <button
                                    className="action-btn action-btn--danger action-btn--lg"
                                    disabled={busyId === selected.id || selected.subscription_status === "expired"}
                                    onClick={() => setStatus(selected.id, "expired")}
                                >
                                    Deactivate
                                </button>
                                <button
                                    className="action-btn action-btn--lg"
                                    disabled={busyId === selected.id}
                                    onClick={() => setStatus(selected.id, "trial")}
                                >
                                    Reset to trial
                                </button>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </>
    )
}

const adminStyles = `
  /* ── Layout ── */
  .admin-shell {
    min-height: 100vh;
    background: var(--surface-0);
    color: var(--text-primary);
    font-family: var(--font-body, 'Inter', sans-serif);
  }

  /* ── Login ── */
  .admin-login-screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-0);
    padding: 24px;
  }
  .admin-login-box {
    width: 100%;
    max-width: 380px;
  }
  .admin-login-header {
    text-align: center;
    margin-bottom: 28px;
  }
  .admin-logo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    background: var(--fill-primary);
    border-radius: 12px;
    margin-bottom: 14px;
  }
  .admin-logo-mark {
    color: var(--on-primary);
    font-weight: 700;
    font-size: 15px;
    letter-spacing: 0.5px;
  }
  .admin-logo-mark--sm {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: var(--fill-primary);
    color: var(--on-primary);
    border-radius: 7px;
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 0.5px;
  }
  .admin-login-title {
    font-size: 20px;
    font-weight: 600;
    margin: 0 0 4px;
    color: var(--text-primary);
  }
  .admin-login-sub {
    font-size: 13px;
    color: var(--text-muted);
    margin: 0;
  }
  .admin-login-form {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    box-shadow: var(--shadow-md);
  }
  .field-group { display: flex; flex-direction: column; gap: 5px; }
  .field-label { font-size: 13px; font-weight: 500; color: var(--text-secondary); }

  /* ── Inputs ── */
  .admin-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 9px 12px;
    font-size: 14px;
    color: var(--text-primary);
    font-family: inherit;
    outline: none;
    transition: border-color 150ms;
  }
  .admin-input:focus { border-color: var(--fill-primary); }

  /* ── Buttons ── */
  .admin-btn-primary {
    width: 100%;
    background: var(--fill-primary);
    color: var(--on-primary);
    border: none;
    border-radius: var(--radius);
    padding: 11px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: opacity 150ms;
    margin-top: 2px;
  }
  .admin-btn-primary:hover { opacity: 0.88; }
  .admin-btn-primary:disabled { opacity: 0.5; cursor: wait; }

  .admin-btn-ghost {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    cursor: pointer;
    font-family: inherit;
    transition: background 120ms;
  }
  .admin-btn-ghost:hover { background: var(--surface-1); }
  .admin-btn-ghost--muted { color: var(--text-muted); }

  /* ── Error ── */
  .admin-error {
    font-size: 13px;
    color: var(--text-danger);
    background: var(--bg-danger);
    border: 1px solid var(--border-danger);
    padding: 9px 12px;
    border-radius: var(--radius);
  }

  /* ── Top nav ── */
  .admin-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 56px;
    padding: 0 24px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .admin-nav-brand { display: flex; align-items: center; gap: 10px; }
  .admin-nav-title { font-size: 15px; font-weight: 600; color: var(--text-primary); }
  .admin-nav-actions { display: flex; align-items: center; gap: 8px; }

  /* ── Main content ── */
  .admin-main {
    max-width: 1140px;
    margin: 0 auto;
    padding: 28px 24px 60px;
  }

  /* ── Metric cards ── */
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    margin-bottom: 24px;
  }
  .metrics-grid--sm { margin-bottom: 16px; }

  .metric-card {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px 16px;
    min-width: 0;
  }
  .metric-label { font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.4px; }
  .metric-value { font-size: 22px; font-weight: 600; color: var(--text-primary); line-height: 1.2; }
  .metric-sub { font-size: 11px; color: var(--text-muted); margin-top: 3px; }

  .metric-card--success .metric-value { color: var(--text-success); }
  .metric-card--warning .metric-value { color: var(--text-warning); }
  .metric-card--danger .metric-value { color: var(--text-danger); }
  .metric-card--accent .metric-value { color: var(--text-accent); }

  /* ── Toolbar ── */
  .admin-toolbar {
    display: flex;
    gap: 10px;
    margin-bottom: 14px;
    flex-wrap: wrap;
  }
  .admin-search { flex: 1 1 200px; min-width: 0; }
  .admin-select { flex: 0 0 auto; min-width: 140px; }

  /* ── Table ── */
  .admin-table-wrap {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: var(--shadow-md);
  }
  .admin-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    table-layout: fixed;
  }
  .admin-table thead tr {
    background: var(--surface-1);
    border-bottom: 1px solid var(--border);
  }
  .admin-table th {
    padding: 10px 16px;
    text-align: left;
    font-weight: 600;
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .admin-table tbody tr {
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    transition: background 100ms;
  }
  .admin-table tbody tr:last-child { border-bottom: none; }
  .admin-table tbody tr:hover { background: var(--surface-1); }
  .admin-table tbody tr.row-selected { background: var(--bg-accent); }
  .admin-table td { padding: 13px 16px; vertical-align: middle; }

  .shop-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .shop-owner { font-size: 12px; color: var(--text-muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .td-muted { color: var(--text-secondary); }
  .td-capitalize { text-transform: capitalize; }
  .ta-right { text-align: right; }

  /* ── Row action buttons ── */
  .row-actions { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }

  .action-btn {
    font-size: 12px;
    padding: 4px 10px;
    border-radius: var(--radius);
    cursor: pointer;
    white-space: nowrap;
    font-family: inherit;
    font-weight: 500;
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--text-primary);
    transition: opacity 120ms;
  }
  .action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .action-btn:hover:not(:disabled) { opacity: 0.8; }

  .action-btn--success { background: var(--bg-success); color: var(--text-success); border-color: var(--border-success); }
  .action-btn--danger  { background: var(--bg-danger);  color: var(--text-danger);  border-color: var(--border-danger);  }
  .action-btn--lg      { font-size: 13px; padding: 8px 16px; }

  /* ── Badges ── */
  .badge {
    display: inline-block;
    padding: 3px 9px;
    border-radius: 99px;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }
  .badge-success { background: var(--bg-success); color: var(--text-success); }
  .badge-warning { background: var(--bg-warning); color: var(--text-warning); }
  .badge-danger  { background: var(--bg-danger);  color: var(--text-danger);  }
  .badge-muted   { background: var(--surface-1);  color: var(--text-muted);   }

  /* ── Detail panel ── */
  .detail-panel {
    margin-top: 16px;
    background: var(--surface-2);
    border: 1px solid var(--border-accent);
    border-radius: 12px;
    padding: 20px 24px;
    box-shadow: var(--shadow-md);
  }
  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 18px;
  }
  .detail-name { font-size: 17px; font-weight: 600; }
  .detail-meta { font-size: 13px; color: var(--text-muted); margin-top: 3px; }
  .detail-close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    font-size: 18px;
    padding: 0;
    line-height: 1;
  }
  .detail-close:hover { color: var(--text-primary); }
  .detail-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }

  /* ── Toast ── */
  .admin-toast {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 999;
    padding: 11px 18px;
    border-radius: var(--radius);
    font-size: 14px;
    font-weight: 500;
    box-shadow: var(--shadow-md);
    animation: slideIn 200ms ease;
  }
  .admin-toast--success { background: var(--bg-success); color: var(--text-success); border: 1px solid var(--border-success); }
  .admin-toast--danger  { background: var(--bg-danger);  color: var(--text-danger);  border: 1px solid var(--border-danger);  }

  @keyframes slideIn {
    from { opacity: 0; transform: translateY(-8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ── Empty state ── */
  .admin-empty {
    text-align: center;
    padding: 56px;
    color: var(--text-muted);
    font-size: 14px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 12px;
  }

  /* ── Responsive ── */
  @media (max-width: 640px) {
    .admin-main { padding: 16px 14px 40px; }
    .admin-nav  { padding: 0 14px; }
    .metrics-grid { grid-template-columns: repeat(2, 1fr); }
    .admin-table th:nth-child(2),
    .admin-table td:nth-child(2),
    .admin-table th:nth-child(4),
    .admin-table td:nth-child(4) { display: none; }
  }
`