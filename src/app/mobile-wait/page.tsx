export default async function MobileWait({
  searchParams,
}: {
  searchParams: Promise<{ auth_key?: string }>
}) {
  const sp = await searchParams
  const authKey = sp.auth_key ?? ""

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "20px",
        background: "#0f0e1a",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ color: "#6c63ff", fontSize: "40px" }}>↓</div>
      <p style={{ color: "#fff", fontSize: "18px", fontWeight: 700, margin: 0 }}>
        Signing in&hellip;
      </p>
      <p style={{ color: "#888", fontSize: "14px", margin: 0, textAlign: "center", maxWidth: "260px" }}>
        Complete sign-in in the browser window — the app will open automatically.
      </p>
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){
  var k=${JSON.stringify(authKey)},n=0,iv;
  function redeem(){window.location.replace('/api/mobile-set-cookie?key='+encodeURIComponent(k));}
  function tick(){
    if(++n>150){clearInterval(iv);return;}
    fetch('/api/mobile-auth-poll?key='+encodeURIComponent(k))
      .then(function(r){return r.json();})
      .then(function(d){if(d&&d.done){clearInterval(iv);redeem();}})
      .catch(function(){});
  }
  if(k) iv=setInterval(tick,2000);
})();`,
        }}
      />
    </div>
  )
}
