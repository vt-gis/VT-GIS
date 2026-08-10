(function () {
  "use strict";

  var form = document.getElementById("login-form");
  var userInput = document.getElementById("login-user");
  var passInput = document.getElementById("login-pass");
  var errorEl = document.getElementById("login-error");
  var submitBtn = document.getElementById("login-submit");

  if (!form || !window.VTAuth) return;

  function showError(message) {
    if (!errorEl) return;
    if (!message) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    showError("");
    submitBtn.disabled = true;

    var result = VTAuth.login(userInput.value, passInput.value);
    if (!result.ok) {
      showError(result.message);
      submitBtn.disabled = false;
      passInput.value = "";
      passInput.focus();
      return;
    }

    var params = new URLSearchParams(window.location.search);
    var target = params.get("return") || "index.html";
    if (target.indexOf("login.html") !== -1) target = "index.html";

    var baseEl = document.querySelector("base");
    var base = baseEl ? baseEl.href : "./";
    window.location.href = base + target;
  });
})();
