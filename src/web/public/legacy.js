// The dashboard moved from `/` to `/dashboard` in 0.11.0. Old links such as
// /#/, /#/p/<id>, /#/structure and the older /#<id> are forwarded with the same
// hash before the landing paints. The landing's own section anchors stay here.
(() => {
  const hash = location.hash;
  const own = ["#main", "#flow", "#watch", "#showcase"];
  if (
    hash.startsWith("#/") ||
    (/^#[a-zA-Z0-9_-]+$/.test(hash) && !own.includes(hash))
  )
    location.replace(`/dashboard${hash}`);
})();
