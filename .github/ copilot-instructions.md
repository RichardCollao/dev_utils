# Reglas para los agentes de IA:
- Todas las respuestas del chat deben estar en español.
- Aplicar el Principio de Responsabilidad Única (SRP).
- Nunca agregar lógica de negocio en los modelos.
- En la creación o modificación de modelos en el código, se deben utilizar consultas mediante Prepared Statements o Query Builders, evitando consultas SQL directas siempre que sea posible.
- Evitar complejidad innecesaria en el diseño y desarrollo, priorizando soluciones simples, eficientes y fáciles de mantener. Principio KISS (Keep It Simple, Stupid).
- No implementar funcionalidades hasta que sean estrictamente necesarias. Principio YAGNI (You Aren't Gonna Need It).
- No agregar validaciones o sanitizaciones redundantes (por ejemplo, XSS) a datos que provienen de fuentes internas confiables como la base de datos.
- Respetar la arquitectura, estructura de carpetas y convenciones existentes del proyecto. No introducir nuevos patrones o capas sin una justificación clara.
- Realizar únicamente los cambios mínimos necesarios para cumplir el objetivo solicitado. No modificar código que no esté relacionado con el problema.
- No modificar comportamientos existentes del sistema a menos que sea estrictamente necesario para cumplir el requerimiento.
- Nunca generar ni ejecutar sentencias DDL (por ejemplo: CREATE TABLE, ALTER TABLE, DROP TABLE) dentro de modelos.
- No dejar código muerto ni vestigios innecesarios tras realizar cambios.

Antes de realizar cambios en código, archivos, configuraciones o ejecutar comandos, el agente debe:
- Describir los pasos a realizar de forma breve y estructurada.
- Esperar confirmación explícita del usuario antes de proceder.
- Se excluyen acciones puramente informativas o de análisis.