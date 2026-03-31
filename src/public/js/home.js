let lastProjectsRequestId = 0;

document.addEventListener('DOMContentLoaded', function () {
    loadProjects();
});

// Consulta los proyectos en API y vuelve a poblar la tabla.
function loadProjects() {
    const requestId = ++lastProjectsRequestId;

    request('/api/projects', 'GET', null, function (response) {
        if (requestId !== lastProjectsRequestId) {
            return;
        }

        const projects = Array.isArray(response?.data) ? response.data : [];

        if (typeof poblarTabla === 'function') {
            poblarTabla(projects);
        }

        if (typeof poblarSelect === 'function') {
            poblarSelect(projects);
        }
    });
}