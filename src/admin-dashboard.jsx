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
        active: { bg: "var(--bg-success)", color: "var(--text-success)", label: "Active" },
        trial: { bg: left <= 3 ? "var(--bg-danger)" : "var(--bg-warning)", color: left <= 3 ? "var(--text-danger)" : "var(--text-warning)", label: left === 0 ? "Trial ended" : `Trial · ${left}d left` },
        expired: { bg: "var(--bg-danger)", color: "var(--text-danger)", label: "Expired" },
        cancelled: { bg: "var(--surface-1)", color: "var(--text-muted)", label: "Cancelled" },
    }[status] || { bg: "var(--surface-1)", color: "var(--text-muted)", label: status }
    return (
        <span style={{ background: cfg.bg, color: cfg.color, padding: "2px 8px", borderRadius: 99, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>
            {cfg.label}
        </span>
    )
}

function MetricCard({ label, value, sub, color }) {
    return (
        <div style={{ background: "var(--surface-1)", borderRadius: "var(--radius)", padding: "1rem", minWidth: 0 }}>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 500, color: color || "var(--text-primary)" }}>{value}</div>
            {sub && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{sub}</div>}
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
            const cutoff = new Date(Date.now() - 30 * 86400000)
                ; (salesData || []).forEach((s) => {
                    salesMap[s.business_id] = (salesMap[s.business_id] || 0) + Number(s.total_amount)
                    if (new Date(s.created_at) > cutoff) {
                        recentSalesMap[s.business_id] = (recentSalesMap[s.business_id] || 0) + 1
                    }
                })
            const staffMap = {}
                ; (staffData || []).forEach((s) => {
                    staffMap[s.business_id] = (staffMap[s.business_id] || 0) + 1
                })

            setBusinesses((data || []).map((b) => ({
                ...b,
                totalSales: salesMap[b.id] || 0,
                salesLast30: recentSalesMap[b.id] || 0,
                staffCount: staffMap[b.id] || 0,
            })))
        } catch (err) {
            showToast("Failed to load: " + err.message, "danger")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (session?.access_token) loadBusinesses(session.access_token)
    }, [session])

    function showToast(msg, type = "success") {
        setToast({ msg, type })
        setTimeout(() => setToast(null), 3500)
    }

    async function setStatus(id, status) {
        setBusyId(id)
        const extra = status === "active" ? { trial_ends_at: new Date(Date.now() + 365 * 86400000).toISOString() } : {}
        try {
            await sbUpdate(`/businesses?id=eq.${id}`, { subscription_status: status, ...extra }, session.access_token)
            setBusinesses((prev) => prev.map((b) => b.id === id ? { ...b, subscription_status: status, ...extra } : b))
            if (selected?.id === id) setSelected((s) => ({ ...s, subscription_status: status, ...extra }))
            showToast(`Account ${status === "active" ? "activated" : status === "expired" ? "deactivated" : status}`)
        } catch (err) {
            showToast(err.message, "danger")
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
            <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-0)", padding: 24 }}>
                <div style={{ width: "100%", maxWidth: 360 }}>
                    <div style={{ marginBottom: 32, textAlign: "center" }}>
                        <div style={{ fontSize: 22, fontWeight: 500, marginBottom: 4 }}>StockTracer admin</div>
                        <div style={{ fontSize: 14, color: "var(--text-muted)" }}>Owner access only</div>
                    </div>
                    <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "1.5rem" }}>
                        <form onSubmit={login} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            <div>
                                <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>Email</div>
                                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: "100%", boxSizing: "border-box" }} />
                            </div>
                            <div>
                                <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>Password</div>
                                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus style={{ width: "100%", boxSizing: "border-box" }} />
                            </div>
                            {loginErr && <div style={{ fontSize: 13, color: "var(--text-danger)", background: "var(--bg-danger)", padding: "8px 12px", borderRadius: "var(--radius)" }}>{loginErr}</div>}
                            <button type="submit" disabled={loginBusy} style={{ marginTop: 4, background: "var(--fill-primary)", color: "var(--on-primary)", border: "none", borderRadius: "var(--radius)", padding: "10px 0", fontWeight: 500, cursor: loginBusy ? "wait" : "pointer" }}>
                                {loginBusy ? "Signing in…" : "Sign in"}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div style={{ minHeight: "100vh", background: "var(--surface-0)", color: "var(--text-primary)" }}>
            {toast && (
                <div style={{ position: "fixed", top: 16, right: 16, zIndex: 100, background: toast.type === "danger" ? "var(--bg-danger)" : "var(--bg-success)", color: toast.type === "danger" ? "var(--text-danger)" : "var(--text-success)", border: `0.5px solid ${toast.type === "danger" ? "var(--border-danger)" : "var(--border-success)"}`, borderRadius: "var(--radius)", padding: "10px 16px", fontSize: 14, fontWeight: 500, boxShadow: "var(--shadow-md)" }}>
                    {toast.msg}
                </div>
            )}

            <div style={{ borderBottom: "0.5px solid var(--border)", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52, background: "var(--surface-2)" }}>
                <div style={{ fontWeight: 500, fontSize: 15 }}>StockTracer admin</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <button onClick={() => loadBusinesses(session.access_token)} style={{ fontSize: 13, padding: "4px 10px" }}>
                        <i className="ti ti-refresh" aria-hidden style={{ marginRight: 4 }} />Refresh
                    </button>
                    <button onClick={() => setSession(null)} style={{ fontSize: 13, padding: "4px 10px", color: "var(--text-muted)" }}>Sign out</button>
                </div>
            </div>

            <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 24px 48px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 28 }}>
                    <MetricCard label="Total shops" value={metrics.total} />
                    <MetricCard label="Active (paid)" value={metrics.active} color="var(--text-success)" />
                    <MetricCard label="On trial" value={metrics.trial} color="var(--text-warning)" />
                    <MetricCard label="Expiring soon" value={metrics.expiring} color="var(--text-danger)" sub="≤ 3 days left" />
                    <MetricCard label="Expired" value={metrics.expired} color="var(--text-danger)" />
                    <MetricCard label="Est. MRR" value={`UGX ${(metrics.totalRevenue).toLocaleString()}`} color="var(--text-accent)" sub="active × 80k" />
                </div>

                <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                    <input placeholder="Search by shop or owner name…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: "1 1 200px", minWidth: 0 }} />
                    <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ flex: "0 0 auto" }}>
                        <option value="all">All statuses</option>
                        <option value="active">Active</option>
                        <option value="trial">Trial</option>
                        <option value="expiring">Expiring soon</option>
                        <option value="expired">Expired</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
                </div>

                {loading ? (
                    <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)", fontSize: 14 }}>Loading businesses…</div>
                ) : filtered.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)", fontSize: 14 }}>No businesses match your filter.</div>
                ) : (
                    <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, tableLayout: "fixed" }}>
                            <thead>
                                <tr style={{ background: "var(--surface-1)", borderBottom: "0.5px solid var(--border)" }}>
                                    <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 500, fontSize: 12, color: "var(--text-muted)", width: "25%" }}>Shop</th>
                                    <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 500, fontSize: 12, color: "var(--text-muted)", width: "13%" }}>Type</th>
                                    <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 500, fontSize: 12, color: "var(--text-muted)", width: "17%" }}>Status</th>
                                    <th style={{ padding: "10px 8px", textAlign: "right", fontWeight: 500, fontSize: 12, color: "var(--text-muted)", width: "10%" }}>Staff</th>
                                    <th style={{ padding: "10px 8px", textAlign: "right", fontWeight: 500, fontSize: 12, color: "var(--text-muted)", width: "13%" }}>Sales 30d</th>
                                    <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 500, fontSize: 12, color: "var(--text-muted)", width: "22%" }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((b, i) => (
                                    <tr
                                        key={b.id}
                                        style={{ borderBottom: i < filtered.length - 1 ? "0.5px solid var(--border)" : "none", cursor: "pointer", background: selected?.id === b.id ? "var(--bg-accent)" : "transparent" }}
                                        onClick={() => setSelected(selected?.id === b.id ? null : b)}
                                    >
                                        <td style={{ padding: "12px 16px" }}>
                                            <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</div>
                                            {b.owner_name && <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.owner_name}</div>}
                                        </td>
                                        <td style={{ padding: "12px 16px", color: "var(--text-secondary)", textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.type}</td>
                                        <td style={{ padding: "12px 16px" }}><StatusBadge status={b.subscription_status} trialEndsAt={b.trial_ends_at} /></td>
                                        <td style={{ padding: "12px 8px", textAlign: "right", color: "var(--text-secondary)" }}>{b.staffCount}</td>
                                        <td style={{ padding: "12px 8px", textAlign: "right", color: "var(--text-secondary)" }}>{b.salesLast30}</td>
                                        <td style={{ padding: "12px 16px", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                                            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                                                {b.subscription_status !== "active" && (
                                                    <button
                                                        disabled={busyId === b.id}
                                                        onClick={() => setStatus(b.id, "active")}
                                                        style={{ fontSize: 12, padding: "4px 10px", background: "var(--bg-success)", color: "var(--text-success)", border: "0.5px solid var(--border-success)", borderRadius: "var(--radius)", cursor: "pointer", whiteSpace: "nowrap" }}
                                                    >
                                                        {busyId === b.id ? "…" : "Activate"}
                                                    </button>
                                                )}
                                                {b.subscription_status === "active" && (
                                                    <button
                                                        disabled={busyId === b.id}
                                                        onClick={() => setStatus(b.id, "expired")}
                                                        style={{ fontSize: 12, padding: "4px 10px", background: "var(--bg-danger)", color: "var(--text-danger)", border: "0.5px solid var(--border-danger)", borderRadius: "var(--radius)", cursor: "pointer", whiteSpace: "nowrap" }}
                                                    >
                                                        {busyId === b.id ? "…" : "Deactivate"}
                                                    </button>
                                                )}
                                                {b.subscription_status !== "trial" && (
                                                    <button
                                                        disabled={busyId === b.id}
                                                        onClick={() => setStatus(b.id, "trial")}
                                                        style={{ fontSize: 12, padding: "4px 10px", borderRadius: "var(--radius)", cursor: "pointer", whiteSpace: "nowrap" }}
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

                {selected && (
                    <div style={{ marginTop: 16, background: "var(--surface-2)", border: "0.5px solid var(--border-accent)", borderRadius: 12, padding: "1.25rem 1.5rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                            <div>
                                <div style={{ fontWeight: 500, fontSize: 16 }}>{selected.name}</div>
                                <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
                                    {selected.type} · created {new Date(selected.created_at).toLocaleDateString()}
                                    {selected.owner_name ? ` · ${selected.owner_name}` : ""}
                                </div>
                            </div>
                            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 18, padding: 0 }}>✕</button>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 16 }}>
                            <MetricCard label="Status" value={<StatusBadge status={selected.subscription_status} trialEndsAt={selected.trial_ends_at} />} />
                            <MetricCard label="Trial ends" value={selected.trial_ends_at ? new Date(selected.trial_ends_at).toLocaleDateString() : "N/A"} sub={selected.subscription_status === "trial" ? `${daysLeft(selected.trial_ends_at)} days left` : ""} />
                            <MetricCard label="Staff" value={selected.staffCount} />
                            <MetricCard label="Sales (30d)" value={selected.salesLast30} />
                            <MetricCard label="Total revenue" value={`UGX ${selected.totalSales.toLocaleString()}`} color="var(--text-accent)" />
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button disabled={busyId === selected.id || selected.subscription_status === "active"} onClick={() => setStatus(selected.id, "active")} style={{ background: "var(--bg-success)", color: "var(--text-success)", border: "0.5px solid var(--border-success)", borderRadius: "var(--radius)", padding: "7px 14px", fontSize: 13, cursor: "pointer", fontWeight: 500 }}>
                                Activate account
                            </button>
                            <button disabled={busyId === selected.id || selected.subscription_status === "expired"} onClick={() => setStatus(selected.id, "expired")} style={{ background: "var(--bg-danger)", color: "var(--text-danger)", border: "0.5px solid var(--border-danger)", borderRadius: "var(--radius)", padding: "7px 14px", fontSize: 13, cursor: "pointer", fontWeight: 500 }}>
                                Deactivate
                            </button>
                            <button disabled={busyId === selected.id} onClick={() => setStatus(selected.id, "trial")} style={{ borderRadius: "var(--radius)", padding: "7px 14px", fontSize: 13, cursor: "pointer" }}>
                                Reset to trial
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}