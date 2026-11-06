// Loaded synchronously in <head> so the first paint already uses the
// viewer's light/dark preference; the DS switches on <html data-theme>.
(() => {
  const media = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    document.documentElement.dataset.theme = media.matches ? "dark" : "light";
  };
  apply();
  media.addEventListener("change", apply);
})();
