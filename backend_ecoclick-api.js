(function () {
  const API_URL = "https://ecoclick-api.onrender.com";

  window.EcoAPI = {
    async request(endpoint, options = {}) {
      const response = await fetch(API_URL + endpoint, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Erro na comunicação com o servidor.");
      }

      return data;
    }
  };
})();
