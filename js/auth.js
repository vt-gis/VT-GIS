(function (global) {
  "use strict";

  var SESSION_KEY = "vt_gis_auth_session";
  var SESSION_MS = 8 * 60 * 60 * 1000;

  /* Usuários autorizados — altere em produção (padrão: vtgis / vtgis2024) */
  var USERS = {};

  function sha256Hex(message) {
    function rotr(n, x) {
      return (x >>> n) | (x << (32 - n));
    }
    function ch(x, y, z) {
      return (x & y) ^ (~x & z);
    }
    function maj(x, y, z) {
      return (x & y) ^ (x & z) ^ (y & z);
    }
    function sigma0(x) {
      return rotr(2, x) ^ rotr(13, x) ^ rotr(22, x);
    }
    function sigma1(x) {
      return rotr(6, x) ^ rotr(11, x) ^ rotr(25, x);
    }
    function gamma0(x) {
      return rotr(7, x) ^ rotr(18, x) ^ (x >>> 3);
    }
    function gamma1(x) {
      return rotr(17, x) ^ rotr(19, x) ^ (x >>> 10);
    }

    var K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];

    var bytes = [];
    for (var i = 0; i < message.length; i += 1) {
      var code = message.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }

    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (var j = 7; j >= 0; j -= 1) {
      bytes.push((bitLen / Math.pow(2, j * 8)) & 0xff);
    }

    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

    for (var offset = 0; offset < bytes.length; offset += 64) {
      var W = new Array(64);
      for (var t = 0; t < 16; t += 1) {
        W[t] =
          (bytes[offset + t * 4] << 24) |
          (bytes[offset + t * 4 + 1] << 16) |
          (bytes[offset + t * 4 + 2] << 8) |
          bytes[offset + t * 4 + 3];
      }
      for (var t2 = 16; t2 < 64; t2 += 1) {
        W[t2] = (gamma1(W[t2 - 2]) + W[t2 - 7] + gamma0(W[t2 - 15]) + W[t2 - 16]) | 0;
      }

      var a = H[0];
      var b = H[1];
      var c = H[2];
      var d = H[3];
      var e = H[4];
      var f = H[5];
      var g = H[6];
      var h = H[7];

      for (var t3 = 0; t3 < 64; t3 += 1) {
        var T1 = (h + sigma1(e) + ch(e, f, g) + K[t3] + W[t3]) | 0;
        var T2 = (sigma0(a) + maj(a, b, c)) | 0;
        h = g;
        g = f;
        f = e;
        e = (d + T1) | 0;
        d = c;
        c = b;
        b = a;
        a = (T1 + T2) | 0;
      }

      H[0] = (H[0] + a) | 0;
      H[1] = (H[1] + b) | 0;
      H[2] = (H[2] + c) | 0;
      H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0;
      H[5] = (H[5] + f) | 0;
      H[6] = (H[6] + g) | 0;
      H[7] = (H[7] + h) | 0;
    }

    var hex = "";
    for (var hi = 0; hi < H.length; hi += 1) {
      for (var shift = 28; shift >= 0; shift -= 4) {
        hex += ((H[hi] >>> shift) & 0xf).toString(16);
      }
    }
    return hex;
  }

  USERS.vtgis = sha256Hex("vtgis2024");

  function appBase() {
    var baseEl = document.querySelector("base");
    return baseEl ? baseEl.href : "./";
  }

  function readSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var session = JSON.parse(raw);
      if (!session || !session.user || !session.expires || !session.token) return null;
      if (Date.now() > session.expires) {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      return session;
    } catch (err) {
      return null;
    }
  }

  function randomToken() {
    var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    var token = "";
    for (var i = 0; i < 32; i += 1) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }

  var auth = {
    isAuthenticated: function () {
      return !!readSession();
    },

    getUser: function () {
      var session = readSession();
      return session ? session.user : null;
    },

    login: function (username, password) {
      var user = (username || "").trim().toLowerCase();
      var pass = password || "";
      if (!user || !pass) {
        return { ok: false, message: "Informe usuário e senha." };
      }

      var expected = USERS[user];
      if (!expected || sha256Hex(pass) !== expected) {
        return { ok: false, message: "Usuário ou senha inválidos." };
      }

      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          user: user,
          token: randomToken(),
          expires: Date.now() + SESSION_MS,
        })
      );

      return { ok: true };
    },

    logout: function () {
      sessionStorage.removeItem(SESSION_KEY);
      window.location.href = appBase() + "login.html";
    },

    requireAuth: function () {
      if (auth.isAuthenticated()) return;
      var returnUrl = window.location.pathname.split("/").pop() + window.location.search;
      if (!returnUrl || returnUrl === "login.html") {
        window.location.replace(appBase() + "login.html");
        return;
      }
      window.location.replace(
        appBase() + "login.html?return=" + encodeURIComponent(returnUrl)
      );
    },

    redirectIfAuthenticated: function () {
      if (!auth.isAuthenticated()) return;
      var params = new URLSearchParams(window.location.search);
      var target = params.get("return") || "index.html";
      if (target.indexOf("login.html") !== -1) target = "index.html";
      window.location.replace(appBase() + target);
    },
  };

  global.VTAuth = auth;
})(window);
