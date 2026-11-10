// Abre el side panel al hacer clic en el ícono de la extensión.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('Pert-day: no se pudo configurar el side panel', err));
});
