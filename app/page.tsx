export default function Home() {
  return (
    <main style={{ maxWidth: 720 }}>
      <h1>Jane Appointments API</h1>
      <p>
        Jane App integration exposed as JSON endpoints for a Retell voice agent.
        Reads use Jane&apos;s public online-booking API (no login); booking requires
        configured staff credentials.
      </p>
      <h2>Endpoints</h2>
      <ul>
        <li>
          <code>GET /api/health</code> — liveness check
        </li>
        <li>
          <code>GET /api/staff</code> — practitioners (public)
        </li>
        <li>
          <code>GET /api/treatments</code> — treatments (public)
        </li>
        <li>
          <code>GET /api/locations</code> — locations (public)
        </li>
        <li>
          <code>POST /api/appointments</code> — create an appointment (requires
          <code> x-api-key</code> and configured credentials)
        </li>
      </ul>
      <p style={{ color: '#666' }}>
        Configure <code>JANE_BASE_URL</code> (and, for booking,{' '}
        <code>JANE_USERNAME</code> / <code>JANE_PASSWORD</code> /{' '}
        <code>RETELL_WEBHOOK_SECRET</code>) in your Vercel project environment
        variables.
      </p>
    </main>
  );
}
