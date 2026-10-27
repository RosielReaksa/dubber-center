/**
 * Applies the saved theme before paint so there is never a flash (F1).
 * Kept inline and tiny; it must run synchronously in <head>.
 */
export function ThemeScript() {
  const script = `
(function(){
  try {
    var saved = localStorage.getItem('dc-theme');
    var system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    var theme = saved === 'light' || saved === 'dark' ? saved : system;
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}