'use client';

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Interactive test console for the Jane integration. Log in with the clinic URL
 * + staff credentials (NOT from env), then exercise every endpoint: list/search
 * staff, pull a selected staff's availability, search/create a patient, and book
 * an appointment. Talks only to the same-origin /api/console/* routes.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function api(path: string, opts: { method?: string; json?: unknown } = {}): Promise<Json> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: opts.json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  return data;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// ---- styles ---------------------------------------------------------------
const card: CSSProperties = {
  border: '1px solid #e2e2e2',
  borderRadius: 10,
  padding: 18,
  marginBottom: 18,
  background: '#fff',
};
const h2: CSSProperties = { fontSize: 18, margin: '0 0 12px' };
const label: CSSProperties = { display: 'block', fontSize: 13, color: '#444', margin: '8px 0 2px' };
const input: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #ccc',
  borderRadius: 6,
  fontSize: 14,
  boxSizing: 'border-box',
};
const btn: CSSProperties = {
  padding: '8px 14px',
  border: '1px solid #2b6cb0',
  background: '#2b6cb0',
  color: '#fff',
  borderRadius: 6,
  fontSize: 14,
  cursor: 'pointer',
};
const btnGhost: CSSProperties = { ...btn, background: '#fff', color: '#2b6cb0' };
const errBox: CSSProperties = {
  background: '#fff5f5',
  border: '1px solid #feb2b2',
  color: '#c53030',
  padding: '8px 10px',
  borderRadius: 6,
  fontSize: 13,
  margin: '8px 0',
  whiteSpace: 'pre-wrap',
};
const pre: CSSProperties = {
  background: '#f7fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  padding: 10,
  fontSize: 12,
  overflowX: 'auto',
  maxHeight: 280,
};

function Err({ msg }: { msg: string | null }) {
  return msg ? <div style={errBox}>{msg}</div> : null;
}

// ---- root -----------------------------------------------------------------
export default function Home() {
  const [booted, setBooted] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');

  useEffect(() => {
    api('/api/console/session')
      .then((s) => {
        setAuthed(Boolean(s?.authenticated));
        setBaseUrl(s?.baseUrl ?? '');
      })
      .catch(() => undefined)
      .finally(() => setBooted(true));
  }, []);

  return (
    <main style={{ maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24 }}>Jane Test Console</h1>
      <p style={{ color: '#666', marginTop: -6 }}>
        Manually exercise every endpoint. Credentials are entered here, never read
        from environment variables.
      </p>
      {!booted ? (
        <p>Loading…</p>
      ) : authed ? (
        <Console
          baseUrl={baseUrl}
          onLogout={() => {
            setAuthed(false);
            setBaseUrl('');
          }}
        />
      ) : (
        <Login
          onLoggedIn={(url) => {
            setBaseUrl(url);
            setAuthed(true);
          }}
        />
      )}
    </main>
  );
}

// ---- login ----------------------------------------------------------------
function Login({ onLoggedIn }: { onLoggedIn: (baseUrl: string) => void }) {
  const [mode, setMode] = useState<'cookie' | 'password'>('cookie');
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sessionCookie, setSessionCookie] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      const json =
        mode === 'cookie'
          ? { baseUrl, sessionCookie }
          : { baseUrl, username, password };
      const res = await api('/api/console/login', { method: 'POST', json });
      onLoggedIn(res.baseUrl ?? baseUrl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const tab = (m: 'cookie' | 'password'): CSSProperties => ({
    ...btnGhost,
    borderColor: mode === m ? '#2b6cb0' : '#ccc',
    background: mode === m ? '#ebf8ff' : '#fff',
    color: mode === m ? '#2b6cb0' : '#666',
    marginRight: 8,
  });

  return (
    <section style={card}>
      <h2 style={h2}>1 · Log in</h2>
      <div style={{ marginBottom: 12 }}>
        <button style={tab('cookie')} onClick={() => setMode('cookie')}>
          Session cookie
        </button>
        <button style={tab('password')} onClick={() => setMode('password')}>
          Username + password
        </button>
      </div>

      <label style={label}>Jane clinic URL</label>
      <input
        style={input}
        placeholder="https://yourclinic.janeapp.com"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
      />

      {mode === 'cookie' ? (
        <>
          <label style={label}>
            <code>_front_desk_session</code> cookie value
          </label>
          <textarea
            style={{ ...input, minHeight: 70, fontFamily: 'monospace' }}
            placeholder="paste the _front_desk_session value…"
            value={sessionCookie}
            onChange={(e) => setSessionCookie(e.target.value)}
          />
          <p style={{ color: '#999', fontSize: 12, marginTop: 6 }}>
            In a tab where you&apos;re logged into Jane admin: DevTools → Application
            → Cookies → your clinic → copy <code>_front_desk_session</code> (the
            large httpOnly session cookie — Jane admin does not use
            <code>_jane_session</code>). This avoids Jane&apos;s new-device
            verification (which blocks server-side password login from Vercel).
          </p>
        </>
      ) : (
        <>
          <label style={label}>Username / email</label>
          <input style={input} value={username} onChange={(e) => setUsername(e.target.value)} />
          <label style={label}>Password</label>
          <input
            style={input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <p style={{ color: '#b7791f', fontSize: 12, marginTop: 6 }}>
            Note: Jane challenges logins from new IPs (incl. Vercel) with an emailed
            code, which this can&apos;t answer — use the session-cookie tab if it fails.
          </p>
        </>
      )}

      <Err msg={err} />
      <div style={{ marginTop: 12 }}>
        <button
          style={btn}
          onClick={submit}
          disabled={busy || !baseUrl || (mode === 'cookie' ? !sessionCookie : !username || !password)}
        >
          {busy ? 'Signing in…' : 'Log in'}
        </button>
      </div>
    </section>
  );
}

// ---- console (post-login) -------------------------------------------------
interface Staff {
  id: number;
  full_name?: string;
  professional_name?: string;
  all_treatment_ids?: number[];
  location_ids?: number[];
}
interface Treatment {
  id: number;
  name?: string;
  scheduled_duration?: number;
  staff_member_id?: number;
}
interface Loc {
  id: number;
  name?: string;
}
interface Patient {
  id: number;
  name?: string;
  email?: string;
  mobilePhone?: string;
}

function Console({ baseUrl, onLogout }: { baseUrl: string; onLogout: () => void }) {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [locations, setLocations] = useState<Loc[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [staffSearch, setStaffSearch] = useState('');
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [slotStart, setSlotStart] = useState('');

  async function loadAll() {
    setLoading(true);
    setLoadErr(null);
    try {
      const [s, t, l] = await Promise.all([
        api('/api/console/staff'),
        api('/api/console/treatments'),
        api('/api/console/locations'),
      ]);
      setStaff(Array.isArray(s) ? s : []);
      setTreatments(Array.isArray(t) ? t : []);
      setLocations(Array.isArray(l) ? l : []);
      setLoaded(true);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await api('/api/console/logout', { method: 'POST' }).catch(() => undefined);
    onLogout();
  }

  const filteredStaff = useMemo(() => {
    const q = staffSearch.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((s) => (s.full_name ?? s.professional_name ?? '').toLowerCase().includes(q));
  }, [staff, staffSearch]);

  const staffName = (s: Staff) => s.full_name ?? s.professional_name ?? `Staff #${s.id}`;

  return (
    <>
      <div
        style={{
          ...card,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#f0fff4',
          borderColor: '#9ae6b4',
        }}
      >
        <span style={{ fontSize: 14 }}>
          ✓ Connected to <strong>{baseUrl}</strong>
        </span>
        <button style={btnGhost} onClick={logout}>
          Log out
        </button>
      </div>

      {/* 2 · Staff */}
      <section style={card}>
        <h2 style={h2}>2 · Staff</h2>
        {!loaded ? (
          <button style={btn} onClick={loadAll} disabled={loading}>
            {loading ? 'Loading…' : 'Load staff, treatments & locations'}
          </button>
        ) : (
          <>
            <input
              style={input}
              placeholder="Search staff by name…"
              value={staffSearch}
              onChange={(e) => setStaffSearch(e.target.value)}
            />
            <div style={{ marginTop: 10, maxHeight: 260, overflowY: 'auto' }}>
              {filteredStaff.map((s) => (
                <Row
                  key={s.id}
                  active={selectedStaff?.id === s.id}
                  onClick={() => setSelectedStaff(s)}
                >
                  <strong>{staffName(s)}</strong>{' '}
                  <span style={{ color: '#888' }}>
                    · id {s.id} · {(s.all_treatment_ids ?? []).length} treatments ·{' '}
                    {(s.location_ids ?? []).length} locations
                  </span>
                </Row>
              ))}
              {filteredStaff.length === 0 && <p style={{ color: '#888' }}>No matches.</p>}
            </div>
          </>
        )}
        <Err msg={loadErr} />
      </section>

      {/* 3 · Availability */}
      {selectedStaff && (
        <Availability
          staff={selectedStaff}
          staffName={staffName(selectedStaff)}
          treatments={treatments}
          locations={locations}
          onUseSlot={(start) => {
            setSlotStart(start);
          }}
        />
      )}

      {/* 4 · Patients */}
      <Patients selected={patient} onSelect={setPatient} />

      {/* 5 · Book */}
      <Booking
        staff={selectedStaff}
        staffName={selectedStaff ? staffName(selectedStaff) : ''}
        treatments={treatments}
        locations={locations}
        patient={patient}
        slotStart={slotStart}
      />
    </>
  );
}

function Row({
  children,
  active,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '8px 10px',
        borderRadius: 6,
        cursor: onClick ? 'pointer' : 'default',
        fontSize: 14,
        marginBottom: 4,
        border: active ? '1px solid #2b6cb0' : '1px solid #eee',
        background: active ? '#ebf8ff' : '#fafafa',
      }}
    >
      {children}
    </div>
  );
}

// ---- availability ---------------------------------------------------------
function Availability({
  staff,
  staffName,
  treatments,
  locations,
  onUseSlot,
}: {
  staff: Staff;
  staffName: string;
  treatments: Treatment[];
  locations: Loc[];
  onUseSlot: (start: string) => void;
}) {
  const staffTreatments = useMemo(() => {
    const ids = new Set(staff.all_treatment_ids ?? []);
    const scoped = treatments.filter((t) => ids.has(t.id) || t.staff_member_id === staff.id);
    return scoped.length ? scoped : treatments;
  }, [staff, treatments]);
  const staffLocations = useMemo(() => {
    const ids = new Set(staff.location_ids ?? []);
    const scoped = locations.filter((l) => ids.has(l.id));
    return scoped.length ? scoped : locations;
  }, [staff, locations]);

  const [treatmentId, setTreatmentId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [startDate, setStartDate] = useState(isoDate(new Date()));
  const [endDate, setEndDate] = useState(isoDate(new Date(Date.now() + 14 * 86400000)));
  const [result, setResult] = useState<Json>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setErr(null);
    setBusy(true);
    setResult(null);
    try {
      const data = await api('/api/console/availability', {
        method: 'POST',
        json: {
          staffMemberId: staff.id,
          treatmentId: Number(treatmentId),
          locationId: Number(locationId),
          startDate,
          endDate,
        },
      });
      setResult(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Pull bookable start times out of the (clinic-dependent) openings shape.
  const slots: string[] = useMemo(() => {
    if (!Array.isArray(result)) return [];
    const out: string[] = [];
    for (const entry of result) {
      for (const o of entry?.openings ?? []) {
        const start = o?.start_at ?? o?.start ?? o?.startAt ?? (typeof o === 'string' ? o : null);
        if (typeof start === 'string') out.push(start);
      }
    }
    return out;
  }, [result]);

  return (
    <section style={card}>
      <h2 style={h2}>3 · Availability — {staffName}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={label}>Treatment</label>
          <select style={input} value={treatmentId} onChange={(e) => setTreatmentId(e.target.value)}>
            <option value="">Select…</option>
            {staffTreatments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name ?? `Treatment ${t.id}`} ({t.scheduled_duration ?? '?'}m)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={label}>Location</label>
          <select style={input} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Select…</option>
            {staffLocations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name ?? `Location ${l.id}`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={label}>Start date</label>
          <input style={input} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label style={label}>End date</label>
          <input style={input} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      <Err msg={err} />
      <div style={{ marginTop: 12 }}>
        <button style={btn} onClick={run} disabled={busy || !treatmentId || !locationId}>
          {busy ? 'Checking…' : 'Get availability'}
        </button>
      </div>

      {slots.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <strong style={{ fontSize: 14 }}>Open slots ({slots.length}):</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {slots.map((s, i) => (
              <button key={i} style={btnGhost} onClick={() => onUseSlot(s)}>
                {s} →
              </button>
            ))}
          </div>
        </div>
      )}
      {result != null && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: '#555' }}>
            Raw response{slots.length === 0 ? ' (no parsable slots — no shifts configured?)' : ''}
          </summary>
          <pre style={pre}>{JSON.stringify(result, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}

// ---- patients -------------------------------------------------------------
function Patients({
  selected,
  onSelect,
}: {
  selected: Patient | null;
  onSelect: (p: Patient) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Patient[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [mobilePhone, setMobile] = useState('');
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function search() {
    setErr(null);
    setBusy(true);
    try {
      const data = await api(`/api/console/patients?q=${encodeURIComponent(q)}`);
      setResults(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setCreateErr(null);
    setCreating(true);
    try {
      const p = await api('/api/console/patients', {
        method: 'POST',
        json: { firstName, lastName, email, mobilePhone },
      });
      onSelect(p);
      setResults((r) => [p, ...r]);
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section style={card}>
      <h2 style={h2}>4 · Patient</h2>
      {selected && (
        <div style={{ ...errBox, background: '#ebf8ff', borderColor: '#90cdf4', color: '#2c5282' }}>
          Selected: <strong>{selected.name}</strong> (id {selected.id})
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={input}
          placeholder="Search by name, email, or phone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <button style={btn} onClick={search} disabled={busy || !q.trim()}>
          {busy ? '…' : 'Search'}
        </button>
      </div>
      <Err msg={err} />
      <div style={{ marginTop: 10 }}>
        {results.map((p) => (
          <Row key={p.id} active={selected?.id === p.id} onClick={() => onSelect(p)}>
            <strong>{p.name || `Patient ${p.id}`}</strong>{' '}
            <span style={{ color: '#888' }}>
              · id {p.id}
              {p.email ? ` · ${p.email}` : ''}
              {p.mobilePhone ? ` · ${p.mobilePhone}` : ''}
            </span>
          </Row>
        ))}
      </div>

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', fontSize: 14 }}>+ Create a new patient</summary>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
          <div>
            <label style={label}>First name *</label>
            <input style={input} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <label style={label}>Last name *</label>
            <input style={input} value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div>
            <label style={label}>Email</label>
            <input style={input} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label style={label}>Mobile phone</label>
            <input style={input} value={mobilePhone} onChange={(e) => setMobile(e.target.value)} />
          </div>
        </div>
        <Err msg={createErr} />
        <div style={{ marginTop: 12 }}>
          <button style={btn} onClick={create} disabled={creating || !firstName || !lastName}>
            {creating ? 'Creating…' : 'Create patient'}
          </button>
        </div>
      </details>
    </section>
  );
}

// ---- booking --------------------------------------------------------------
function Booking({
  staff,
  staffName,
  treatments,
  locations,
  patient,
  slotStart,
}: {
  staff: Staff | null;
  staffName: string;
  treatments: Treatment[];
  locations: Loc[];
  patient: Patient | null;
  slotStart: string;
}) {
  const [treatmentId, setTreatmentId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [startAt, setStartAt] = useState('');
  const [duration, setDuration] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<Json>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Prefill the start when a slot is picked in the availability panel.
  useEffect(() => {
    if (slotStart) setStartAt(slotStart);
  }, [slotStart]);

  const staffTreatments = useMemo(() => {
    if (!staff) return treatments;
    const ids = new Set(staff.all_treatment_ids ?? []);
    const scoped = treatments.filter((t) => ids.has(t.id) || t.staff_member_id === staff.id);
    return scoped.length ? scoped : treatments;
  }, [staff, treatments]);

  async function book() {
    setErr(null);
    setBusy(true);
    setResult(null);
    try {
      const data = await api('/api/console/appointments', {
        method: 'POST',
        json: {
          staffMemberId: staff?.id,
          treatmentId: Number(treatmentId),
          patientId: patient?.id,
          locationId: Number(locationId),
          startAt,
          durationMinutes: duration ? Number(duration) : undefined,
          note: note || undefined,
        },
      });
      setResult(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = staff && patient && treatmentId && locationId && startAt;
  const state = result?.state ?? result?.appointment?.state;

  return (
    <section style={card}>
      <h2 style={h2}>5 · Book appointment</h2>
      <div style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
        Staff: <strong>{staff ? `${staffName} (id ${staff.id})` : '— select in step 2 —'}</strong>
        <br />
        Patient:{' '}
        <strong>{patient ? `${patient.name} (id ${patient.id})` : '— select in step 4 —'}</strong>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={label}>Treatment</label>
          <select style={input} value={treatmentId} onChange={(e) => setTreatmentId(e.target.value)}>
            <option value="">Select…</option>
            {staffTreatments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name ?? `Treatment ${t.id}`} ({t.scheduled_duration ?? '?'}m)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={label}>Location</label>
          <select style={input} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Select…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name ?? `Location ${l.id}`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={label}>Start (ISO-8601 with offset)</label>
          <input
            style={input}
            placeholder="2026-06-15T14:00:00-04:00"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
          />
        </div>
        <div>
          <label style={label}>Duration (min, optional)</label>
          <input style={input} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </div>
        <div style={{ gridColumn: '1 / 3' }}>
          <label style={label}>Note (optional)</label>
          <input style={input} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <Err msg={err} />
      <div style={{ marginTop: 12 }}>
        <button style={btn} onClick={book} disabled={busy || !ready}>
          {busy ? 'Booking…' : 'Book appointment'}
        </button>
        {!ready && (
          <span style={{ color: '#999', fontSize: 12, marginLeft: 10 }}>
            Need staff, patient, treatment, location and start.
          </span>
        )}
      </div>
      {result != null && (
        <div style={{ marginTop: 12 }}>
          {state && (
            <div
              style={{
                ...errBox,
                background: state === 'booked' ? '#f0fff4' : '#fffaf0',
                borderColor: state === 'booked' ? '#9ae6b4' : '#fbd38d',
                color: state === 'booked' ? '#22543d' : '#7b341e',
              }}
            >
              Appointment state: <strong>{state}</strong>
            </div>
          )}
          <pre style={pre}>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}
