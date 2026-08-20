/* Partnership form enhancements: deep-linkable organisation type and a
   conditionally required licence field for regulated organisation types.
   The form is fully usable with this script blocked. */
(function () {
  'use strict';
  var form = document.querySelector('form[data-form="partnership"]');
  if (!form) return;

  var typeSelect = form.querySelector('#organization_type');
  var licenceField = form.querySelector('[data-if-regulated]');
  var licenceInput = form.querySelector('#licence_status');
  var REGULATED = ['bank_or_payment_institution', 'fx_or_liquidity', 'regulator_or_government'];

  var preset = new URLSearchParams(location.search).get('type');
  var PRESETS = {
    institution: 'bank_or_payment_institution',
    bank: 'bank_or_payment_institution',
    enterprise: 'enterprise_or_trade',
    regulator: 'regulator_or_government',
    technology: 'technology_provider',
    compliance: 'compliance_provider',
    research: 'research_organization',
    fx: 'fx_or_liquidity'
  };
  if (preset && PRESETS[preset]) {
    typeSelect.value = PRESETS[preset];
    if (window.ekoTrack) window.ekoTrack('form_prefill', { form: 'partnership', type: PRESETS[preset] });
  }

  function syncLicence() {
    var regulated = REGULATED.indexOf(typeSelect.value) !== -1;
    licenceInput.required = regulated;
    licenceField.querySelector('label').innerHTML = regulated
      ? 'Relevant licence or regulatory status <span class="req" aria-hidden="true">*</span>'
      : 'Relevant licence or regulatory status';
  }
  typeSelect.addEventListener('change', syncLicence);
  syncLicence();
})();
