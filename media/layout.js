// Minimizar painéis laterais e seções
(function () {
  function setup({ left, right, initial, save }) {
    const state = { ...initial };
    const updates = [];
    const toggle = (key) => {
      state[key] = !state[key];
      updates.forEach((update) => update());
      save(state);
    };

    function side(el, key, name, open, close) {
      const button = (cls, title, ...kids) => h('button', { class: cls, title, 'aria-label': title, onclick: () => toggle(key) }, ...kids);
      el.querySelector('h2').append(button('minimize', `Minimizar ${name}`, close));
      el.append(button('restore', `Mostrar ${name}`, open, h('span', {}, name)));
      updates.push(() => el.classList.toggle('minimized', !!state[key]));
    }

    function section(title, content, key) {
      const name = title.textContent;
      const arrow = h('span', { class: 'twist' });
      const button = h('button', { class: 'section-toggle', onclick: () => toggle(key) }, arrow, name);
      title.replaceChildren(button);
      updates.push(() => {
        content.hidden = !!state[key];
        arrow.textContent = state[key] ? '▸' : '▾';
        button.setAttribute('aria-expanded', String(!state[key]));
      });
    }

    const [palette, props] = right.querySelectorAll('h2');
    section(palette, palette.nextElementSibling, 'palette');
    section(props, props.nextElementSibling, 'props');
    side(left, 'left', 'Report Inspector', '»', '«');
    side(right, 'right', 'Palette e Properties', '«', '»');
    updates.forEach((update) => update());
  }

  window.Layout = { setup };
})();
