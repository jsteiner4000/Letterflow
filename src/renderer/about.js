window.letterflow.info().then((info) => {
  document.getElementById('version').textContent = `Version ${info.version}`;
});
window.letterflow.licenses().then((t) => {
  document.getElementById('lizenzen').textContent = t;
});
