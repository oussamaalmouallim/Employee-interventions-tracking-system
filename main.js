// =================================================================
// TECHNICIAN FORM APPLICATION
// Professional intervention reporting system
// =================================================================

window.jsPDF = window.jspdf.jsPDF;

// Global state
const AppState = {
  problemTypeHistory: [],
  interventionTypeHistory: [],
  updateSummaryTimeout: null
};

// Constants
const CONSTANTS = {
  GEOLOCATION_OPTIONS: {
    enableHighAccuracy: true,
    timeout: 3000,
    maximumAge: 0
  },
  UPDATE_INTERVALS: {
    DATETIME: 1000,
    LOCATION_RETRY: 60000
  },
  SUMMARY_THROTTLE: 300,
  NOMINATIM_API: 'https://nominatim.openstreetmap.org/reverse',
  SUPABASE: {
    URL: 'https://quflgxjymdocfcqwppxl.supabase.co',
    KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1ZmxneGp5bWRvY2ZjcXdwcHhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA4MjI5NzAsImV4cCI6MjA1NjM5ODk3MH0.084B-my88YIXT0TZ2uD0UT82xU2M4yRhBv2idNUSjLQ'
  },
  SUPABASE_TABLE: 'tis_interventions',
  GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwslJzwnb1OZA2VahPAafUrqr7_xah-xh-CUp88pzuSGm8KMUQu_1TReL1yhKYOmqn5iw/exec'
};

// DOM Elements cache
const DOM = {};

// =================================================================
// UTILITY FUNCTIONS
// =================================================================

/**
 * Cleans text for database keys
 */
const cleanKeyForDB = (key) => {
  return key.toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[()]/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/'/g, '_')
    .replace(/\//g, '_');
};

/**
 * Throttled function executor
 */
const throttle = (func, delay) => {
  return (...args) => {
    clearTimeout(AppState.updateSummaryTimeout);
    AppState.updateSummaryTimeout = setTimeout(() => func(...args), delay);
  };
};

// =================================================================
// TIME & LOCATION MODULE
// =================================================================

class TimeLocationManager {
  static init() {
    setInterval(TimeLocationManager.updateDateTime, CONSTANTS.UPDATE_INTERVALS.DATETIME);
    TimeLocationManager.updateDateTime();
    TimeLocationManager.initLocation();
  }

  static updateDateTime() {
    const now = new Date();
    DOM.datetime.textContent = now.toLocaleString('fr-FR');
  }

  static async getLocationDetails(latitude, longitude) {
    try {
      const response = await fetch(
        `${CONSTANTS.NOMINATIM_API}?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
        { headers: { 'Accept-Language': 'fr' } }
      );
      
      if (!response.ok) throw new Error('Erreur réseau');
      return (await response.json()).display_name;
    } catch (error) {
      console.error('Erreur lors de la récupération de l\'adresse:', error);
      return null;
    }
  }

  static async updateLocation() {
    const locationDiv = DOM.location;
    locationDiv.textContent = 'Recherche de la position...';

    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, CONSTANTS.GEOLOCATION_OPTIONS);
      });

      const { latitude, longitude } = position.coords;
      locationDiv.innerHTML = `
        <div>Coordonnées trouvées</div>
        <div class="location-details">
          Latitude: ${latitude.toFixed(6)}<br>
          Longitude: ${longitude.toFixed(6)}
        </div>
      `;

      const address = await this.getLocationDetails(latitude, longitude);
      if (address) {
        locationDiv.innerHTML = `
          <div>${address}</div>
          <div class="location-details">
            Latitude: ${latitude.toFixed(6)}<br>
            Longitude: ${longitude.toFixed(6)}
          </div>
        `;
      }
    } catch (error) {
      locationDiv.textContent = `Erreur de localisation: ${error.message}`;
    }
  }

  static initLocation() {
    this.updateLocation();
    setInterval(() => {
      const content = DOM.location.textContent;
      if (content.includes('Erreur') || content.includes('Recherche')) {
        this.updateLocation();
      }
    }, CONSTANTS.UPDATE_INTERVALS.LOCATION_RETRY);
  }
}

// =================================================================
// FORM MANAGEMENT MODULE
// =================================================================

const PROBLEMS_BY_TYPE = {
  electricite: ['Pannes de courant', 'Problèmes de câblage', 'Prises défectueuses', 'Éclairage défaillant', 'Autre'],
  domotique: ['Problèmes de connectivité', 'Bugs logiciels', 'Erreurs de configuration', 'Mises à jour manquantes', 'Incompatibilité des appareils', "Configuration point d'accès", 'Autre'],
  'climatisation/chauffage': ['Insuffisance de refroidissement', 'Problèmes de thermostat', 'Bruits inhabituels', 'Autre'],
  sonorisation: ['Problèmes de connectivité', 'Qualité sonore dégradée', 'Défaillance des amplificateurs', 'Pannes des haut-parleurs', 'Autre'],
  videophone: ['Problèmes de connexion réseau', "Problèmes d'alimentation", 'Qualité vidéo ou audio dégradée', "Bouton d'appel défectueux", 'Problèmes de synchronisation', 'Installation', 'Configuration', 'Autre'],
  supervision: ['Problèmes de connectivité', 'Erreurs système', 'Problèmes d\'affichage', 'Erreurs de données', 'Autre'],
  autre: ['Autre']
};

class FormManager {
  static init() {
    this.cacheDOMElements();
    this.bindEvents();
  }

  static cacheDOMElements() {
    DOM.interventionType = document.getElementById('interventionType');
    DOM.problemType = document.getElementById('problemType');
    DOM.technicianName = document.getElementById('technicianName');
    DOM.interventionStatus = document.getElementById('interventionStatus');
    DOM.comments = document.getElementById('comments');
    DOM.projectName = document.getElementById('projectName');
    DOM.submissionDate = document.getElementById('submissionDate');
    DOM.statusRadios = document.querySelectorAll('input[name="status"]');
    DOM.technicianForm = document.getElementById('technicianForm');
    DOM.toggleSummary = document.getElementById('toggleSummary');
    DOM.summaryModal = document.getElementById('summaryModal');
    DOM.summaryTableBody = document.getElementById('summaryTableBody');
    DOM.location = document.getElementById('location');
    DOM.datetime = document.getElementById('datetime');
  }

  static bindEvents() {
    DOM.interventionType.addEventListener('change', this.handleInterventionTypeChange.bind(this));
    DOM.problemType.addEventListener('change', this.handleProblemTypeChange.bind(this));
    DOM.statusRadios.forEach(radio => radio.addEventListener('change', this.handleStatusChange.bind(this)));
    DOM.technicianName.addEventListener('change', this.handleSelectChange.bind(this, DOM.technicianName));
    DOM.interventionStatus.addEventListener('change', this.handleSelectChange.bind(this, DOM.interventionStatus));
    DOM.comments.addEventListener('input', throttle(this.updateSummaryTable, CONSTANTS.SUMMARY_THROTTLE));
    DOM.projectName.addEventListener('input', throttle(this.updateSummaryTable, CONSTANTS.SUMMARY_THROTTLE));
    DOM.submissionDate.addEventListener('change', throttle(this.updateSummaryTable, CONSTANTS.SUMMARY_THROTTLE));
    DOM.toggleSummary.addEventListener('click', this.toggleSummaryModal.bind(this));
    DOM.technicianForm.addEventListener('submit', this.handleGoogleSheetSubmit.bind(this));
  }

  static handleInterventionTypeChange(e) {
    const selectedType = e.target.value;
    
    // Clear previous problem options
    DOM.problemType.innerHTML = '<option value="">Sélectionnez le problème</option>';
    document.querySelectorAll('.response-tag').forEach(tag => tag.remove());

    // Record history
    if (selectedType) {
      AppState.interventionTypeHistory.push({
        type: selectedType,
        text: e.target.options[e.target.selectedIndex].text,
        timestamp: new Date()
      });
    }

    // Populate problems
    if (selectedType && PROBLEMS_BY_TYPE[selectedType]) {
      const problemList = selectedType === 'domotique' 
        ? [...PROBLEMS_BY_TYPE[selectedType], 'Configuration Domotique']
        : PROBLEMS_BY_TYPE[selectedType];

      problemList.forEach(problem => {
        const option = document.createElement('option');
        option.value = problem.toLowerCase().replace(/\s+/g, '_');
        option.textContent = problem;
        DOM.problemType.appendChild(option);
      });
    }
  }

  static handleProblemTypeChange(e) {
    if (e.target.value) {
      AppState.problemTypeHistory.push({
        value: e.target.value,
        text: e.target.options[e.target.selectedIndex].text,
        timestamp: new Date()
      });
    }
    this.createResponseTag(e.target);
    this.updateSummaryTable();
  }

  static handleStatusChange(e) {
    const radioGroup = e.target.closest('.radio-group');
    const existingTag = radioGroup.nextElementSibling;
    if (existingTag?.className === 'response-tag') existingTag.remove();

    const responseTag = document.createElement('div');
    responseTag.className = 'response-tag';
    responseTag.textContent = e.target.labels[0].textContent;
    radioGroup.after(responseTag);
    this.updateSummaryTable();
  }

  static handleSelectChange(selectElement, e) {
    const existingTag = selectElement.nextElementSibling;
    if (existingTag?.className === 'response-tag') existingTag.remove();

    const responseTag = document.createElement('div');
    responseTag.className = 'response-tag';
    responseTag.textContent = selectElement.options[selectElement.selectedIndex].text;
    selectElement.parentNode.appendChild(responseTag);
    this.updateSummaryTable();
  }

  static createResponseTag(selectElement) {
    const existingTag = selectElement.parentNode.querySelector('.response-tag');
    if (existingTag) existingTag.remove();

    const responseTag = document.createElement('div');
    responseTag.className = 'response-tag';
    responseTag.textContent = selectElement.options[selectElement.selectedIndex].text;
    selectElement.parentNode.appendChild(responseTag);
  }

  static updateSummaryTable() {
    const summaryTableBody = DOM.summaryTableBody;
    summaryTableBody.innerHTML = '';

    const rows = this.getSummaryRows();
    
    rows.forEach(([field, value]) => {
      if (this.isValidSummaryValue(value)) {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${field}</td><td>${value}</td>`;
        summaryTableBody.appendChild(row);
      }
    });
  }

  static getSummaryRows() {
    const status = document.querySelector('input[name="status"]:checked');
    
    return [
      ['Date de Soumission', DOM.submissionDate.value],
      ['Date et Heure', DOM.datetime.textContent],
      ['Localisation', DOM.location.textContent],
      ['Projet/Client', DOM.projectName.value],
      ['Technicien', DOM.technicianName.options[DOM.technicianName.selectedIndex].text],
      ['Type d\'Intervention', DOM.interventionType.options[DOM.interventionType.selectedIndex].text],
      ['Nature du Problème', DOM.problemType.options[DOM.problemType.selectedIndex].text],
      ['État', status ? status.labels[0].textContent : ''],
      ['Statut de l\'intervention', DOM.interventionStatus.options[DOM.interventionStatus.selectedIndex].text],
      ['Commentaires', DOM.comments.value || "Pas de commentaire"]
    ].concat(
      AppState.interventionTypeHistory.length > 1 
        ? [['Historique des Types d\'Intervention', 
            AppState.interventionTypeHistory.slice(0, -1)
              .map(h => `${h.text} (${new Date(h.timestamp).toLocaleTimeString()})`).join(', ')]] 
        : [],
      AppState.problemTypeHistory.length > 1 
        ? [['Historique des Problèmes', 
            AppState.problemTypeHistory.slice(0, -1)
              .map(h => `${h.text} (${new Date(h.timestamp).toLocaleTimeString()})`).join(', ')]] 
        : []
    );
  }

  static isValidSummaryValue(value) {
    const invalidValues = [
      '', 'Sélectionnez un technicien', 'Sélectionnez le type', 
      'Sélectionnez le problème', 'Sélectionnez le statut'
    ];
    return value && !invalidValues.includes(value);
  }

  static toggleSummaryModal() {
    const modalContent = DOM.summaryModal.querySelector('.modal-content');
    
    this.updateSummaryTable();
    
    DOM.summaryModal.classList.toggle('modal-show');
    modalContent.classList.toggle('modal-content-show');
    
    this.updateToggleIcon();
  }

  static updateToggleIcon() {
    const iconPaths = {
      active: `<path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 8c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm0-13C7 2 2.73 5.11 1 9.5 2.73 13.89 7 17 12 17s9.27-3.11 11-7.5C21.27 5.11 17 2 12 2zm0 13c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z"/>`,
      inactive: `<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>`
    };

    DOM.toggleSummary.innerHTML = DOM.toggleSummary.classList.contains('active')
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">${iconPaths.active}</svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">${iconPaths.inactive}</svg>`;
  }

  static async handleGoogleSheetSubmit(e) {
    e.preventDefault();
    
    const submitBtn = document.getElementById('submitTogooglesheet');
    this.setButtonLoadingState(submitBtn, 'Envoi en cours...');

    try {
      const formData = new FormData(DOM.technicianForm);
      const response = await fetch(CONSTANTS.GOOGLE_SCRIPT_URL, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error('Erreur réseau');
      
      await response.text();
      this.setButtonSuccessState(submitBtn, 'Send to Google Sheet');
      alert('Données envoyées avec succès !');
    } catch (error) {
      console.error('Google Sheet submission error:', error);
      this.setButtonErrorState(submitBtn, 'Try again');
      alert('Erreur lors de l\'envoi des données.');
    }
  }

  static setButtonLoadingState(button, text) {
    button.innerText = text;
    button.classList.add('active');
  }

  static setButtonSuccessState(button, iconHTML) {
    button.innerHTML = iconHTML;
    setTimeout(() => button.classList.remove('active'), 2000);
  }

  static setButtonErrorState(button, iconHTML) {
    button.innerHTML = iconHTML;
    button.classList.remove('active');
  }
}

// =================================================================
// SUPABASE MODULE
// =================================================================

class SupabaseManager {
  static async init() {
    await this.loadSupabaseLibrary();
  }

  static async loadSupabaseLibrary() {
    return new Promise((resolve) => {
      if (window.supabase) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/@supabase/supabase-js';
      script.onload = () => {
        window.supabaseClient = window.supabase.createClient(
          CONSTANTS.SUPABASE.URL,
          CONSTANTS.SUPABASE.KEY
        );
        resolve();
      };
      document.head.appendChild(script);
    });
  }

  static createSubmitButton() {
    const button = document.createElement('button');
    button.id = 'submitToSupabase';
    button.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-6h2v6zm4 0h-2v-6h2v6zm-2-8h-2V7h2v2z"/>
      </svg>
      Send to Supabase
    `;
    button.style.marginTop = '10px';
    
    document.querySelector('.form-actions').appendChild(button);
    button.addEventListener('click', this.handleSubmit.bind(this));
  }

  static async handleSubmit(event) {
    event.preventDefault();
    const button = event.target;
    
    button.classList.add('active');
    
    try {
      const reportData = this.collectReportData();
      console.log('Submitting to Supabase:', reportData);

      const { data, error } = await window.supabaseClient
        .from(CONSTANTS.SUPABASE_TABLE)
        .insert([reportData]);

      if (error) throw error;

      this.showSuccess(button);
      alert('Rapport soumis avec succès sur Supabase !');
      
      // Reset histories
      AppState.problemTypeHistory = [];
      AppState.interventionTypeHistory = [];
      
    } catch (error) {
      console.error('Supabase submission error:', error);
      this.showError(button);
      alert(`Erreur lors de l'envoi du rapport à Supabase : ${error.message}`);
    }
  }

  static collectReportData() {
    const summaryRows = Array.from(DOM.summaryTableBody.querySelectorAll('tr'));
    const reportData = {};

    summaryRows.forEach(row => {
      const [field, value] = row.querySelectorAll('td');
      const cleanedKey = cleanKeyForDB(field.textContent);
      reportData[cleanedKey] = value.textContent;
    });

    return reportData;
  }

  static showSuccess(button) {
    button.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
      </svg>
      Sent to Supabase, thank you!
    `;
    setTimeout(() => button.classList.remove('active'), 2000);
  }

  static showError(button) {
    button.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-6h2v6zm4 0h-2v-6h2v6zm-2-8h-2V7h2v2z"/>
      </svg>
      Try again
    `;
    button.classList.remove('active');
  }
}

// =================================================================
// MODAL EVENT LISTENERS
// =================================================================

function initModalEvents() {
  // Close button
  document.getElementById('closeModal').addEventListener('click', closeSummaryModal);
  
  // Outside click
  DOM.summaryModal.addEventListener('click', (e) => {
    if (e.target === DOM.summaryModal) closeSummaryModal();
  });
}

function closeSummaryModal() {
  const modalContent = DOM.summaryModal.querySelector('.modal-content');
  modalContent.classList.remove('modal-content-show');
  
  setTimeout(() => {
    DOM.summaryModal.classList.remove('modal-show');
    DOM.toggleSummary.classList.remove('active');
    FormManager.updateToggleIcon();
  }, 300);
}

// =================================================================
// INITIALIZATION
// =================================================================

async function initApp() {
  try {
    // Cache DOM elements first
    FormManager.cacheDOMElements();
    
    // Initialize modules
    TimeLocationManager.init();
    FormManager.init();
    initModalEvents();
    
    // Initialize Supabase
    await SupabaseManager.init();
    await SupabaseManager.createSubmitButton();
    
    console.log('✅ Technician Form App initialized successfully');
  } catch (error) {
    console.error('❌ App initialization failed:', error);
  }
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
