// SplashDown concept site: the height ruler (the page's live thing), the ride cards that cross the
// held photograph, and the entrance layer. Everything degrades to a readable page without script.
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.remove("no-js");

  // ---------------------------------------------------------------- the height ruler
  // Prices from the park's 2026 list. Seniors pay the under-48 price; kids 2 and under (about 36"
  // and shorter is not a reliable proxy, so the ruler only mentions it) are free.
  var PRICE = { over: { weekday: 19, weekend: 20 }, under: { weekday: 15, weekend: 15.5 } };
  var ticket = document.querySelector("[data-ticket]");
  if (ticket) {
    var input = ticket.querySelector("#height");
    var out = ticket.querySelector("[data-height-out]");
    var what = ticket.querySelector("[data-what]");
    var rides = ticket.querySelector("[data-rides]");
    var price = ticket.querySelector("[data-price]");
    var per = ticket.querySelector("[data-per]");
    var day = "weekend";

    var money = function (n) { return "$" + (n % 1 ? n.toFixed(2) : n); };
    var ridesFor = function (h) {
      if (h >= 48) return "Rides every slide in the park, Pipeline Tower and Cannonball included.";
      if (h >= 42) return "Tropical Twister, the lazy river, the log walk and all four kids' cove slides. The tower waits for 48″.";
      return "The kids' cove: zero-depth water, bubblers and four small slides. Life vests in every size.";
    };
    var render = function () {
      var h = Number(input.value);
      var tall = h >= 48 ? "over" : "under";
      out.textContent = h + "″";
      input.setAttribute("aria-valuetext", h + " inches");
      what.textContent = "Day ticket, " + (tall === "over" ? "over" : "under") + " 48″";
      price.textContent = money(PRICE[tall][day]);
      per.textContent = day === "weekday" ? "Tuesday to Friday" : "weekends and holidays";
      rides.textContent = ridesFor(h);
      // the park map listens: one rider height for the whole page
      document.dispatchEvent(new CustomEvent("height:changed", { detail: h }));
      // the ruler also sorts the ride cards: the ones that do not fit this height step back
      document.querySelectorAll(".card[data-min]").forEach(function (card) {
        var min = Number(card.getAttribute("data-min"));
        var max = card.hasAttribute("data-max") ? Number(card.getAttribute("data-max")) : 999;
        card.classList.toggle("is-out", h < min || h >= max);
      });
    };
    input.addEventListener("input", render);
    document.addEventListener("height:set", function (e) { input.value = String(e.detail); render(); });
    ticket.querySelectorAll("[data-day]").forEach(function (b) {
      b.addEventListener("click", function () {
        day = b.getAttribute("data-day");
        ticket.querySelectorAll("[data-day]").forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
        render();
      });
    });
    render();

  }

  // ---------------------------------------------------------------- ride cards cross the held photo
  var section = document.querySelector(".rides");
  var track = document.querySelector("[data-track]");
  var wide = window.matchMedia("(min-width: 721px)");
  if (section && track && !reduce) {
    var tick = function () {
      if (!wide.matches) { track.style.removeProperty("--x"); return; }
      var r = section.getBoundingClientRect();
      var run = section.offsetHeight - window.innerHeight;
      var p = Math.min(1, Math.max(0, -r.top / run));
      var card = track.firstElementChild.getBoundingClientRect().width;
      var travel = track.scrollWidth - (window.innerWidth / 2 + card / 2); // the last card ends centred
      track.style.setProperty("--x", String(-p * travel));
      section.style.setProperty("--p", p.toFixed(3));
    };
    window.addEventListener("scroll", function () { requestAnimationFrame(tick); }, { passive: true });
    window.addEventListener("resize", tick);
    tick();
  }

  // ---------------------------------------------------------------- entrances, staggered per section
  // (the motion itself is a CSS scroll timeline; script only tags the parts and their order)
  var groups = [
    [".tickets", ".tickets__title, .tickets__lead, .ticket, .tickets__more"],
    [".day", ".day__title, .day__intro p"],
    [".food", ".food__title, .menu__group, .food__note"],
    [".faq", ".faq__title, .faq details"],
    [".foot", ".foot__title, .foot__actions .btn, .foot__col"]
  ];
  var items = [];
  groups.forEach(function (g) {
    document.querySelectorAll(g[1]).forEach(function (el, i) {
      el.classList.add("rise");
      el.style.setProperty("--i", String(Math.min(i, 6)));
      items.push(el);
    });
  });

})();
