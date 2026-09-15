/**
 * Root page.
 *
 * Deliberately says nothing about which magnets exist. This host is reachable
 * from every campaign URL, and an index of live and draft slugs is an invitation
 * to go looking. Each magnet is found at /m/<slug> or not at all.
 */
export default function Page() {
  return (
    <main
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif",
        maxWidth: "32rem",
        margin: "20vh auto",
        padding: "0 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>Lead magnets</h1>
      <p style={{ color: "#6b6b6b", margin: 0 }}>
        Nothing to see here. Campaign pages live at their own addresses.
      </p>
    </main>
  );
}
