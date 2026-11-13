/**
 * KwaraCoop OS - Shared Executive Demo Navigation & Toast System
 * Eliminates raw browser alerts and delivers cohesive navigation across all stakeholder views.
 */

(function () {
  // Inject Toast Container
  function ensureToastContainer() {
    let container = document.getElementById('kwara-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'kwara-toast-container';
      container.className = 'fixed bottom-5 right-5 z-[100] flex flex-col gap-3 max-w-sm w-full pointer-events-none px-4 sm:px-0';
      document.body.appendChild(container);
    }
    return container;
  }

  window.KwaraToast = {
    show: function (title, message, type = 'success') {
      const container = ensureToastContainer();
      const toast = document.createElement('div');
      toast.className = 'pointer-events-auto bg-white border border-slate-200 shadow-2xl rounded-2xl p-4 flex items-start gap-3 transform transition-all duration-300 translate-y-4 opacity-0';

      const iconColors = {
        success: 'bg-emerald-100 text-emerald-700',
        info: 'bg-blue-100 text-blue-700',
        warning: 'bg-amber-100 text-amber-700',
        danger: 'bg-red-100 text-red-700'
      };

      const svgs = {
        success: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>',
        info: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
        warning: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>',
        danger: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>'
      };

      toast.innerHTML = `
        <div class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconColors[type] || iconColors.success}">
          ${svgs[type] || svgs.success}
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="text-sm font-bold text-slate-900 leading-tight">${title}</h4>
          <p class="text-xs text-slate-600 mt-1 leading-relaxed">${message}</p>
        </div>
        <button onclick="this.parentElement.remove()" aria-label="Close notification" class="text-slate-400 hover:text-slate-700 p-1 rounded-lg">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      `;

      container.appendChild(toast);
      requestAnimationFrame(() => {
        toast.classList.remove('translate-y-4', 'opacity-0');
      });

      setTimeout(() => {
        toast.classList.add('translate-y-2', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
      }, 4800);
    }
  };
})();
