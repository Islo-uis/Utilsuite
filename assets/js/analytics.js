const GOATCOUNTER_URL = 'https://YOURCODE.goatcounter.com/count';
const ENABLED = !GOATCOUNTER_URL.includes('YOURCODE');

function track(path, title) {
  if (!ENABLED) return;
  try {
    if (window.goatcounter && typeof window.goatcounter.count === 'function') {
      window.goatcounter.count({ path, title, event: true });
      return;
    }
    const img = new Image(1, 1);
    img.src = GOATCOUNTER_URL + '?p=' + encodeURIComponent(path) + '&e=true&t=' + encodeURIComponent(title || '');
  } catch (_) {}
}

export const analytics = {
  trackPageview(name) { track('/page/' + name, name); },
  trackToolOpen(id)    { track('/tool/' + id + '/open', id + ' open'); },
  trackToolStart(id)   { track('/tool/' + id + '/start', id + ' start'); },
  trackToolComplete(id){ track('/tool/' + id + '/complete', id + ' complete'); },
  trackToolDownload(id){ track('/tool/' + id + '/download', id + ' download'); },
  trackError(id, err)  { track('/tool/' + id + '/error', id + ' error'); },
};