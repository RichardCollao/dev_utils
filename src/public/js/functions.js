const app = { activeRequests: 0 };
const CLIENT_LOG_ENDPOINT = '/api/logs/client';

function normalizeLogData(data) {
    if (data === undefined || data === null) return data;

    if (data instanceof Error) {
        return {
            name: data.name,
            message: data.message,
            stack: data.stack
        };
    }

    if (Array.isArray(data)) {
        return data.map(normalizeLogData);
    }

    if (typeof data === 'object') {
        const normalized = {};
        Object.entries(data).forEach(function ([key, value]) {
            normalized[key] = normalizeLogData(value);
        });
        return normalized;
    }

    return data;
}

function sendClientLog(level, event, data) {
    if (typeof fetch !== 'function') return;

    const browserGlobal = globalThis;

    const payload = {
        level,
        event,
        data: normalizeLogData(data),
        url: browserGlobal.location?.href || '',
        userAgent: browserGlobal.navigator?.userAgent || '',
        timestamp: new Date().toISOString()
    };

    fetch(CLIENT_LOG_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        keepalive: true
    }).catch(function () {
    });
}

function initIziToastDefaults() {
    if (typeof iziToast === 'undefined') return;

    if (typeof iziToast.settings === 'function') {
        iziToast.settings({
            position: 'bottomRight'
        });
    }
}

function showIziToast(type, message) {
    if (typeof iziToast === 'undefined') return false;
    if (typeof iziToast[type] !== 'function') return false;

    iziToast[type]({
        message,
        position: 'bottomRight'
    });

    return true;
}

function iziToastError(message) {
    return showIziToast('error', message);
}

function iziToastSuccess(message) {
    return showIziToast('success', message);
}

function shouldSendBody(method, formData) {
    return (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') && !!formData;
}

function buildRequestOptions(method, formData) {
    const headers = new Headers();
    const options = { method, headers, mode: "same-origin", credentials: "include", cache: "default" };

    if (!shouldSendBody(method, formData)) {
        return options;
    }

    if (formData instanceof FormData) {
        options.body = formData;
        return options;
    }

    headers.set('Content-Type', 'application/json');
    options.body = typeof formData === 'string' ? formData : JSON.stringify(formData);
    return options;
}

function formatErrorDetail(detail) {
    if (!detail) return '';
    if (typeof detail === 'string') return detail;
    return JSON.stringify(detail);
}

async function parseErrorResponse(res) {
    let errorMessage = `HTTP Error: ${res.status}`;
    let errorDetail = '';

    try {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const errorJson = await res.json();
            errorMessage = errorJson?.message || errorMessage;
            errorDetail = formatErrorDetail(errorJson?.detail);
            return { errorMessage, errorDetail };
        }

        const errorText = await res.text();
        errorDetail = errorText || '';
    } catch {
        // Si no se puede parsear el body, se usa mensaje por defecto.
    }

    return { errorMessage, errorDetail };
}

function showRequestError(errorMessage, errorDetail = '') {
    const text = errorDetail ? `${errorMessage} - ${errorDetail}` : errorMessage;

    if (typeof Swal !== 'undefined' && typeof Swal.fire === 'function') {
        Swal.fire({ icon: 'error', title: 'Error', text });
        return;
    }

    if (iziToastError(text)) {
        return;
    }
}

function startLoading() {
    if (app.activeRequests === 0) showLoading();
    app.activeRequests++;
}

function stopLoading() {
    app.activeRequests--;
    if (app.activeRequests === 0) hideLoading();
}

async function request(uri, method = "GET", formData = null, callback = () => { }) {
    startLoading();

    const options = buildRequestOptions(method, formData);
    let json = null;

    console.log('[request] start', { uri, method, hasBody: !!formData, formData });
    sendClientLog('info', '[request] start', { uri, method, hasBody: !!formData, formData });

    try {
        const res = await fetch(uri, options);
        console.log('[request] response', {
            uri,
            method,
            status: res.status,
            ok: res.ok,
            contentType: res.headers.get('content-type') || ''
        });
        sendClientLog('info', '[request] response', {
            uri,
            method,
            status: res.status,
            ok: res.ok,
            contentType: res.headers.get('content-type') || ''
        });

        if (!res.ok) {
            const { errorMessage, errorDetail } = await parseErrorResponse(res);
            console.error('[request] http error', { uri, method, errorMessage, errorDetail });
            sendClientLog('error', '[request] http error', { uri, method, errorMessage, errorDetail });
            showRequestError(errorMessage, errorDetail);
            return;
        }

        if (res.status === 204) {
            json = {};
        } else {
            const contentType = res.headers.get('content-type') || '';
            const raw = await res.text();
            const trimmed = raw.trim();

            console.log('[request] raw response', { uri, method, raw: trimmed });
            sendClientLog('info', '[request] raw response', { uri, method, raw: trimmed });

            if (!trimmed) {
                json = {};
            } else if (contentType.includes('application/json')) {
                try {
                    json = JSON.parse(trimmed);
                } catch {
                    throw new Error('La respuesta JSON del servidor es inválida.');
                }
            } else {
                json = { message: trimmed };
            }
        }

        console.log('res.redirect :>> ', json.redirect);
        if (json.redirect) {
            location.href = json.redirect;
            return;
        }
    } catch (error) {
        console.error('[request] exception', {
            uri,
            method,
            name: error?.name,
            message: error?.message,
            stack: error?.stack
        });
        sendClientLog('error', '[request] exception', {
            uri,
            method,
            name: error?.name,
            message: error?.message,
            stack: error?.stack
        });
        const isNetworkError = error?.name === 'TypeError';

        if (isNetworkError) {
            showRequestError('Error de conexión', 'No fue posible completar la solicitud.');
            return;
        }

        const detail = error?.message || 'No fue posible procesar la respuesta del servidor.';
        showRequestError('Error de respuesta', detail);
        return;
    } finally {
        stopLoading();
    }

    try {
        console.log('[request] callback start', { uri, method, json });
        sendClientLog('info', '[request] callback start', { uri, method, json });
        callback(json);
        console.log('[request] callback done', { uri, method });
        sendClientLog('info', '[request] callback done', { uri, method });
    } catch (error) {
        console.error('[request] callback exception', {
            uri,
            method,
            name: error?.name,
            message: error?.message,
            stack: error?.stack
        });
        sendClientLog('error', '[request] callback exception', {
            uri,
            method,
            name: error?.name,
            message: error?.message,
            stack: error?.stack
        });
        const detail = error?.message || 'Se produjo un error ejecutando la respuesta.';
        showRequestError('Error de interfaz', detail);
    }
}

function showLoading() {
    document.getElementById("loading").style.display = "block";
}

function hideLoading() {
    document.getElementById("loading").style.display = "none";
}

initIziToastDefaults();