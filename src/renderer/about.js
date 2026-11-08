window.letterflow.info().then((info) => {
  document.getElementById('version').textContent = `Version ${info.version}`;
});
