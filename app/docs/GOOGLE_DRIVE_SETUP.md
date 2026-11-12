# Configurar Google Cloud para los backups de Kanbaya

Guía paso a paso, sin dar por hecho que sabes usar Google Cloud.

**Objetivo:** preparar la autorización de Google y utilizar las opciones de Kanbaya para guardar e importar backups de tu Drive.

**Importante:** la versión de Kanbaya con esta integración ya incluye los botones de Drive. La configuración de Google y el Client ID deben corresponder a esa instalación. Si utilizas una PWA anterior, primero despliega y activa la actualización.

Los nombres de las pantallas pueden aparecer en español o en inglés. Por eso encontrarás ambas variantes.

## 1. Antes de empezar

Necesitas:

- Una cuenta de Google con acceso a Google Cloud.
- Un navegador con conexión a Internet.
- Saber la dirección donde publicarás Kanbaya, si ya la tienes.

No necesitas crear un servidor, una máquina virtual ni una base de datos en Google.

Piensa en estas tres cosas:

| Nombre | Qué significa, con palabras sencillas |
|---|---|
| Proyecto | Una carpeta de Google Cloud donde agrupas la configuración de Kanbaya. |
| API de Drive | La puerta por la que Kanbaya podrá hablar con Google Drive. |
| Cliente OAuth | La identificación de Kanbaya para pedir permiso al usuario. |

El proyecto no es tu carpeta de backups. Los backups se guardarían en el Drive de la cuenta que autorice el acceso.

### Regla para no perderte

Antes de cambiar cualquier pantalla, mira arriba y comprueba que está seleccionado el proyecto correcto.

Puedes tener varios proyectos. Configurar una cosa en uno y otra cosa en otro es una causa frecuente de problemas.

---

## 2. Elegir o crear el proyecto

### Si ya empezaste antes

1. Abre [Google Cloud Console](https://console.cloud.google.com/).
2. Inicia sesión con la cuenta que estabas utilizando.
3. En la barra superior, pulsa el nombre del proyecto o **Seleccionar un proyecto / Select a project**.
4. Busca **Kanbaya** en la lista.
5. Si aparece, selecciónalo.
6. Continúa por el apartado 3. **No crees otro proyecto solo porque te hayas perdido.**

Si no aparece, comprueba primero que has iniciado sesión con la misma cuenta de Google.

### Si todavía no existe

1. Abre el selector de proyectos de la barra superior.
2. Pulsa **Nuevo proyecto / New project**.
3. En **Nombre del proyecto / Project name**, escribe:

   ```text
   Kanbaya
   ```

4. Google propondrá un **ID del proyecto / Project ID**. Puede añadir letras o números. Eso es normal; no hace falta que sea exactamente `kanbaya`.
5. Si aparece **Organización / Organization** o **Ubicación / Location**, utiliza una ubicación para la que tengas permiso. En una cuenta personal puede aparecer **Sin organización / No organization**.
6. Pulsa **Crear / Create**.
7. Espera a que termine.
8. Vuelve al selector superior y selecciona el proyecto recién creado.

**Comprobación:** arriba aparece el nombre del proyecto Kanbaya.

---

## 3. Encender la API de Google Drive

1. Comprueba que sigues en el proyecto Kanbaya.
2. Abre [la ficha de Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com).
3. Si vuelve a pedirte un proyecto, selecciona Kanbaya.
4. Comprueba que el título dice **Google Drive API**.
5. Pulsa **Habilitar / Enable**.
6. Espera a que termine.

**Si aparece “Administrar / Manage” en lugar de “Habilitar”:** ya está activada. No tienes que hacer nada más en esta pantalla.

También puedes comprobarlo en:

**Menú de Google Cloud → APIs y servicios / APIs & Services → APIs y servicios habilitados / Enabled APIs & services**.

En esa lista debe aparecer **Google Drive API**.

No necesitas configurar la pestaña **Drive UI integration** para preparar los botones de backup dentro de Kanbaya. Esa pestaña sirve para otras funciones, como aparecer en “Abrir con” de Drive.

---

## 4. Preparar la pantalla de permisos: el antiguo “paso 3”

Esta es la parte en la que Google aprende qué nombre debe mostrar cuando Kanbaya pida permiso para usar Drive.

### 4.1. Entrar en la pantalla correcta

1. Abre [Google Auth Platform](https://console.cloud.google.com/auth/overview).
2. Comprueba el proyecto en la barra superior.
3. Mira qué aparece:

| Lo que ves | Qué debes hacer |
|---|---|
| **Comenzar / Get started** | Sigue por el apartado 4.2. |
| Un menú con **Branding**, **Audience**, **Clients** o sus traducciones | La configuración inicial ya existe. Salta al apartado 4.3 para revisarla. |
| Un aviso de falta de permisos | Comprueba la cuenta y el proyecto. Si es un proyecto de una organización, solicita acceso a su administrador. |

En algunas pantallas antiguas, esta sección se encuentra en **APIs y servicios → Pantalla de consentimiento de OAuth**.

### 4.2. Si aparece el asistente “Comenzar”

Pulsa **Comenzar / Get started** y rellena las pantallas una por una.

#### Pantalla: información de la aplicación

1. En **Nombre de la aplicación / App name**, escribe:

   ```text
   Kanbaya
   ```

2. En **Correo de asistencia del usuario / User support email**, selecciona una dirección tuya que puedas revisar.
3. Pulsa **Siguiente / Next**.

Ese correo es un medio de contacto para los usuarios; no es una contraseña.

#### Pantalla: audiencia

1. Para que puedan utilizarla cuentas personales de Google o usuarios ajenos a una misma organización, selecciona **Externa / External**.
2. Pulsa **Siguiente / Next**.

**Interna / Internal** está pensada para usuarios de una misma organización de Google Workspace. No la elijas si quieres permitir cuentas personales de Gmail.

#### Pantalla: información de contacto

1. Introduce una dirección de correo tuya en **Información de contacto / Contact information**.
2. Pulsa **Siguiente / Next**.

Google utilizará esta dirección para avisos sobre el proyecto.

#### Pantalla: finalizar

1. Lee las condiciones que muestra Google.
2. Si estás de acuerdo, marca la casilla de aceptación.
3. Pulsa **Continuar / Continue** y después **Crear / Create**, según lo que muestre el asistente.

**Comprobación:** ya puedes entrar en las secciones de Google Auth Platform.

### 4.3. Si ya lo rellenaste: comprobar los datos sin empezar de nuevo

Abre estas pantallas en este orden:

#### A. Branding / Información de la marca

Entra en [Branding](https://console.cloud.google.com/auth/branding).

Comprueba:

- **Nombre de la aplicación:** Kanbaya.
- **Correo de asistencia:** una dirección tuya correcta.
- **Correo de contacto del desarrollador:** una dirección tuya correcta, si aparece en este formulario.

Si cambias algo, pulsa **Guardar / Save** antes de salir.

**Logo, página principal, política de privacidad y dominios:** para esta primera configuración de pruebas no añadas datos inventados ni un logo si no lo necesitas. Si Google exige un campo, introduce información real. La publicación para todos los usuarios tiene requisitos adicionales que se explican al final.

#### B. Audience / Audiencia

Entra en [Audience](https://console.cloud.google.com/auth/audience).

Comprueba:

- **Tipo de usuario / User type:** External o Externa.
- **Estado de publicación / Publishing status:** Testing o Prueba.

**No pulses “Publicar aplicación / Publish app” todavía.**

#### C. Añadirte como usuario de prueba

En esa misma sección **Audience / Audiencia**:

1. Busca **Usuarios de prueba / Test users**.
2. Pulsa **Añadir usuarios / Add users**.
3. Escribe la dirección de la cuenta de Google con la que probarás Drive.
4. Pulsa **Guardar / Save**.
5. Comprueba que esa cuenta aparece en la lista.

Puedes usar el mismo correo de asistencia y de prueba, pero son campos diferentes: **ser propietario del proyecto no sustituye a añadirte como usuario de prueba**.

Si después pruebas con otra cuenta, también tendrás que añadirla mientras la aplicación esté en modo de pruebas.

**Comprobación del apartado 4:** la aplicación se llama Kanbaya, la audiencia es externa, está en pruebas y tu cuenta aparece como usuario de prueba.

---

## 5. Pedir solo el permiso necesario

1. Abre [Data Access / Acceso a los datos](https://console.cloud.google.com/auth/scopes).
2. Comprueba el proyecto.
3. Pulsa **Añadir o quitar permisos / Add or remove scopes**.
4. Busca este permiso exacto:

   ```text
   https://www.googleapis.com/auth/drive.file
   ```

5. Selecciona la casilla correspondiente a `drive.file`.
6. Si no aparece al buscar, comprueba que Google Drive API está habilitada. Si el formulario ofrece **Añadir permisos manualmente / Manually add scopes**, puedes pegar ahí la dirección anterior.
7. Pulsa **Actualizar / Update**, **Añadir a la tabla / Add to table** o el botón equivalente que aparezca.
8. Pulsa **Guardar / Save** en la pantalla principal si lo solicita.
9. Vuelve a abrir la lista y comprueba que `drive.file` está guardado.

### Qué permite este permiso

Permite trabajar con archivos creados por la aplicación o que el usuario comparta expresamente con ella, por ejemplo mediante el selector de Google.

**No da permiso para ver todos los archivos de tu Drive.**

Por eso, una futura opción de importar archivos subidos manualmente a Drive podría necesitar que los selecciones expresamente. No basta con que estén en una carpeta llamada Kanbaya.

### Qué no debes seleccionar para esta integración

No añadas estos permisos de acceso amplio:

```text
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/drive.readonly
```

Tampoco añadas permisos de Gmail, Calendar o contactos: no hacen falta para los backups.

**Comprobación:** el permiso de Drive añadido es `drive.file`, clasificado por Google como no sensible.

---

## 6. Entender qué dirección debes registrar

Antes de crear el cliente, vamos a distinguir dos cosas:

| Concepto | Ejemplo |
|---|---|
| Dirección completa de la aplicación | `https://TU_USUARIO.github.io/Kanbaya/app/` |
| Origen de la aplicación | `https://TU_USUARIO.github.io` |

El **origen** es solo el principio: protocolo, nombre del servidor y puerto cuando corresponda.

En **Orígenes JavaScript autorizados** no se escribe la carpeta de la aplicación.

Los ejemplos con `TU_USUARIO` no se deben pegar literalmente. Sustituye esa parte por el usuario real de la URL publicada.

### Si utilizas GitHub Pages

1. Abre la aplicación publicada.
2. Mira la dirección del navegador.
3. Copia únicamente la parte que termina en `.github.io`.

Ejemplo inventado:

```text
Dirección de la aplicación:
https://ejemplo.github.io/Kanbaya/app/

Origen que debes registrar:
https://ejemplo.github.io
```

### Si utilizas un dominio propio

Por ejemplo:

```text
https://kanbaya.example
```

Usa tu dominio real, no el del ejemplo. `https://www...` y `https://...` son orígenes diferentes si el nombre del servidor cambia.

### Para probar en tu ordenador

Añadiremos estas dos entradas:

```text
http://localhost
http://localhost:8765
```

La aplicación de desarrollo utiliza el puerto `8765`.

**Importante:** `localhost` y `127.0.0.1` no son el mismo origen para OAuth. Aunque el servidor muestre un enlace con `127.0.0.1`, en las pruebas de esta integración utilizaremos `http://localhost:8765/app/`.

---

## 7. Crear o revisar el cliente OAuth

### 7.1. Antes de crear otro, mirar si ya existe

1. Abre [Clients / Clientes](https://console.cloud.google.com/auth/clients).
2. Comprueba el proyecto.
3. Busca un cliente llamado **Kanbaya Web**, o uno que ya hayas creado para Kanbaya.
4. Si existe, ábrelo y revisa sus datos siguiendo el apartado 7.2.
5. Si no existe, pulsa **Crear cliente / Create client**.

### 7.2. Rellenar el formulario

1. En **Tipo de aplicación / Application type**, elige:

   ```text
   Aplicación web / Web application
   ```

2. En **Nombre / Name**, escribe:

   ```text
   Kanbaya Web
   ```

3. Busca **Orígenes JavaScript autorizados / Authorized JavaScript origins**.
4. Pulsa **Añadir URI / Add URI**.
5. Introduce el origen real de producción que identificaste en el apartado 6.
6. Añade otra entrada:

   ```text
   http://localhost
   ```

7. Añade otra entrada:

   ```text
   http://localhost:8765
   ```

Si todavía no tienes una dirección de producción, puedes comenzar con las entradas locales y añadir la dirección publicada más adelante.

### Ejemplos de entradas correctas e incorrectas

| Entrada | ¿Sirve como origen? | Motivo |
|---|---|---|
| `https://ejemplo.github.io` | Sí, si es tu dirección real | No incluye carpetas. |
| `https://ejemplo.github.io/Kanbaya/app/` | No | Incluye una ruta. |
| `http://localhost:8765` | Sí, para pruebas locales | Incluye el puerto de desarrollo. |
| `http://localhost:8765/app/` | No | Incluye una ruta. |
| `ejemplo.github.io` | No | Falta `https://`. |
| `file:///C:/proyectos/kanbaya/app/index.html` | No | No es un origen web válido para esta integración. |

### Qué hacer con “URI de redirección autorizados”

Para el flujo utilizado, **Google Identity Services con ventana emergente y token en el navegador**, deja ese apartado vacío.

No estamos configurando un servidor que reciba códigos de autorización. No inventes una dirección `/callback`.

Si más adelante se cambia a otro flujo OAuth, habrá que revisar esta decisión.

Finalmente:

1. Pulsa **Crear / Create**, o **Guardar / Save** si estabas editando un cliente existente.
2. Espera a que Google confirme la operación.
3. Vuelve a abrir el cliente y comprueba que los orígenes siguen en la lista.

---

## 8. Guardar el Client ID, no el secreto

Google mostrará un **ID de cliente / Client ID** parecido a este:

```text
1234567890-ejemplo.apps.googleusercontent.com
```

Ese es un ejemplo, no un identificador válido para tu aplicación.

1. Copia tu **Client ID**.
2. Guárdalo para configurar posteriormente Kanbaya.
3. Si cierras la ventana, puedes recuperarlo entrando en **Clients / Clientes → Kanbaya Web**.

### Dos datos que no debes confundir

| Dato | Qué hacer con él |
|---|---|
| **Client ID / ID de cliente** | Se utiliza en la aplicación del navegador. Identifica la aplicación; no es una contraseña. |
| **Client Secret / Secreto del cliente** | No lo necesitamos para este flujo. No lo pegues en el código, en GitHub ni en el chat. |

No hace falta descargar un archivo JSON de credenciales para seguir esta guía. Esos archivos pueden contener el secreto del cliente.

Si envías una captura para pedir ayuda, oculta secretos, tokens, contraseñas y datos personales que no sean necesarios.

---

## 9. Lista final: comprobarlo todo sin recordar dónde estaba

Puedes cerrar las pestañas anteriores y revisar esta tabla:

| Qué comprobar | Dónde volver a entrar | Qué debes encontrar |
|---|---|---|
| Proyecto | Selector de la barra superior de Google Cloud | El mismo proyecto Kanbaya en todas las pantallas. |
| API | [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com) | Activada; aparece **Administrar / Manage**. |
| Nombre y correos | [Branding](https://console.cloud.google.com/auth/branding) | Kanbaya y tus direcciones correctas. |
| Audiencia | [Audience](https://console.cloud.google.com/auth/audience) | Externa y en pruebas. |
| Cuenta de prueba | [Audience](https://console.cloud.google.com/auth/audience) | La cuenta con la que iniciarás sesión está en **Test users**. |
| Permiso | [Data Access](https://console.cloud.google.com/auth/scopes) | `https://www.googleapis.com/auth/drive.file`. |
| Cliente | [Clients](https://console.cloud.google.com/auth/clients) | Kanbaya Web, de tipo aplicación web. |
| Orígenes | Abre Kanbaya Web dentro de Clients | El origen real de producción, si ya lo tienes, y las entradas de localhost. |
| Identificador | Abre Kanbaya Web dentro de Clients | Un Client ID terminado en `.apps.googleusercontent.com`. |

Comprueba siempre el proyecto después de abrir un enlace: Google puede mostrar el último que utilizaste.

Lista para marcar:

- [ ] He seleccionado el mismo proyecto en todas las pantallas.
- [ ] Google Drive API está habilitada.
- [ ] La aplicación se llama Kanbaya.
- [ ] He revisado los correos de asistencia y contacto.
- [ ] La audiencia es externa y está en pruebas.
- [ ] Mi cuenta aparece como usuario de prueba.
- [ ] He añadido el permiso `drive.file`.
- [ ] El cliente es de tipo aplicación web.
- [ ] Los orígenes autorizados no contienen `/Kanbaya/`, `/app/` ni otras rutas.
- [ ] He guardado el Client ID.
- [ ] No he añadido el Client Secret al código ni lo he compartido.

**Si puedes marcar todo, la configuración básica de Google está preparada.**

---

## 10. Conectar Kanbaya y probar un backup

### Comprobar el Client ID de la aplicación

El Client ID público está en la constante `CLIENT_ID` de [app/scripts/drive.js](app/scripts/drive.js).

Comprueba que corresponde al cliente de tipo aplicación web que has configurado. No lo sustituyas por el Client Secret.

Si lo cambias para otra instalación, publica los recursos actualizados con sus versiones técnicas coordinadas, como explica el [README](README.md#offline-support-and-updates).

### Abrir la aplicación

Puedes iniciar el servidor local desde la raíz del proyecto:

```powershell
node app\tests\server.js
```

Y abrir esta dirección para probar OAuth:

```text
http://localhost:8765/app/
```

Si el servidor ya está en marcha, no necesitas iniciarlo otra vez.

**Atención:** los datos locales de `localhost` y `127.0.0.1` están separados. Si en localhost no aparecen tus tableros anteriores, no significa que se hayan borrado: vuelve a la dirección anterior y exporta un backup local para trasladarlos si lo necesitas.

### Guardar el primer backup

1. En Kanbaya, abre el menú **⋯** de la barra superior.
2. Pulsa **Save backup to Google Drive…**.
3. Espera a que se cargue el inicio de sesión de Google.
4. Pulsa **Connect / change Google account**.
5. Elige la cuenta que añadiste como usuario de prueba.
6. Lee y acepta el permiso si quieres continuar.
7. Cuando Kanbaya indique que está conectada, pulsa **Save backup**.
8. Espera al mensaje **Backup saved in Google Drive**.
9. Abre tu Google Drive y busca la carpeta **Kanbaya Backups**.
10. Comprueba que contiene el archivo de backup.

Se incluyen todos los tableros, las plantillas y los adjuntos. Cada guardado crea un archivo nuevo con fecha y hora; no sustituye al anterior.

### Importar un backup guardado

1. Abre **⋯ → Import backup from Google Drive…**.
2. Conecta tu cuenta si la aplicación lo solicita.
3. En **Backup**, selecciona el archivo que quieres recuperar.
4. Si acabas de guardarlo y no aparece, pulsa **Refresh**.
5. Pulsa **Import backup**.
6. Espera al mensaje de importación completada.
7. Cierra el diálogo para ver los tableros.

**Importar añade copias:** no reemplaza ni borra tus tableros actuales.

La lista muestra únicamente backups creados por Kanbaya mediante esta integración. Si subiste un archivo manualmente a Drive, descárgalo y utiliza **Import from file…**. No hemos añadido Google Picker para seleccionar archivos ajenos a la integración.

### Qué pasa con la conexión

- Los tokens de acceso se mantienen solo en memoria; no se guardan en la base de datos ni en los backups.
- Al recargar Kanbaya tendrás que volver a conectar Drive.
- Si la autorización caduca o se revoca, vuelve a pulsar **Connect / change Google account**.
- Cerrar el diálogo no cierra tu sesión de Google ni revoca los permisos.
- Sin Internet puedes seguir editando y utilizando backups locales, pero no guardar ni descargar desde Drive.
- No hay sincronización automática ni transferencias en segundo plano.

---

## 11. Si aparece un problema

Si el diálogo de Drive muestra un error, revisa los siguientes casos. Las opciones locales siguen disponibles aunque falle Google.

### “No sé si terminé la pantalla de consentimiento”

Abre [Branding](https://console.cloud.google.com/auth/branding).

- Si ves el formulario con Kanbaya y los correos, revisa y guarda.
- Si ves **Comenzar / Get started**, termina el apartado 4.2.
- Después revisa [Audience](https://console.cloud.google.com/auth/audience) y añade tu cuenta de prueba.

No crees otro proyecto para resolver esto.

### No encuentro un botón con el mismo nombre que en la guía

Busca su equivalente en inglés. Google cambia la distribución y las traducciones.

Las secciones importantes son **Branding**, **Audience**, **Data Access** y **Clients**. Los enlaces del apartado 9 permiten volver directamente.

### No aparece Google Drive API al añadir permisos

Comprueba que la activaste en el mismo proyecto. Después vuelve a abrir **Data Access**.

### “Access blocked”, “access_denied” o acceso bloqueado

Comprueba:

1. Que inicias sesión con una cuenta incluida en **Test users**.
2. Que la aplicación continúa en modo de pruebas.
3. Que has aceptado el permiso solicitado, si quieres utilizar Drive.
4. Que no existe una restricción de tu organización de Google Workspace.

Si la cuenta está administrada por una organización, puede ser necesaria autorización de su administrador. No intentes saltarte sus restricciones.

### “origin_mismatch”

Significa que la dirección desde la que abres Kanbaya no coincide con los orígenes autorizados.

1. Mira la dirección del navegador.
2. Comprueba protocolo, nombre del servidor y puerto.
3. Abre **Clients → Kanbaya Web**.
4. Corrige el origen y guarda.

Recuerda:

- `http://localhost:8765` no es lo mismo que `http://127.0.0.1:8765`.
- `http://localhost` no incluye automáticamente todos los puertos.
- `http://` no es lo mismo que `https://`.
- No debes añadir `/app/` en el campo de orígenes.

### “redirect_uri_mismatch”

Revisa que la implementación esté utilizando el flujo con ventana emergente y token descrito en esta guía. No añadas direcciones al azar para hacer desaparecer el error.

Si se utiliza un flujo con redirección, necesitará una configuración diferente.

### “invalid_client”

Comprueba que se ha copiado el Client ID completo del cliente de tipo **Aplicación web**, y no el ID del proyecto, el número del proyecto o el secreto del cliente.

### He guardado y parece que no cambia nada

Algunos cambios de Google pueden tardar en aplicarse. Confirma que se han guardado, espera un poco y vuelve a probar. No crees nuevos clientes repetidamente.

### No puedo crear un proyecto o editar sus datos

Comprueba la cuenta con la que has iniciado sesión. En cuentas de empresa pueden existir restricciones para crear proyectos, habilitar APIs o autorizar aplicaciones externas.

Solicita los permisos necesarios al administrador del proyecto o de la organización.

---

## 12. Más adelante: permitir que la use cualquier persona

Para probar con tu cuenta, mantén **Testing / Prueba** y utiliza la lista de usuarios de prueba.

Publicar para el público es un paso posterior. Antes de hacerlo:

1. Confirma la URL definitiva de Kanbaya.
2. Publica y revisa la [Política de Privacidad](../../info/privacy.html) y las [Condiciones del Servicio](../../info/terms.html), incluidos los datos del responsable y el contacto que correspondan a tu instalación.
3. Revisa los enlaces de página principal, privacidad y, cuando corresponda, condiciones.
4. Revisa los dominios autorizados y cualquier verificación de propiedad que solicite Google.
5. Comprueba los requisitos de marca y verificación que muestra la consola.
6. Cuando todo esté listo, revisa el cambio a **In production / En producción**.

**No pongas `github.io` como si fuera un dominio de tu propiedad.** Es un dominio compartido. Si Google solicita un dominio o una verificación, sigue los requisitos para la URL real del proyecto; si el alojamiento compartido no permite satisfacerlos, habrá que valorar un dominio propio.

El permiso `drive.file` es no sensible y reduce el alcance del acceso, pero eso no significa que se puedan omitir los requisitos de marca, privacidad o publicación que Google aplique al proyecto.

No prometas acceso público hasta haber comprobado el resultado en la consola.

### Enlaces públicos para Branding

Las páginas están en el directorio `info/` y se enlazan desde el pie de la web. Si tu despliegue es `https://scaamanho.github.io/Kanbaya/`, introduce estos valores:

| Campo de Google | URL completa |
|---|---|
| Página principal | `https://scaamanho.github.io/Kanbaya/` |
| Política de Privacidad | `https://scaamanho.github.io/Kanbaya/info/privacy.html` |
| Condiciones del Servicio | `https://scaamanho.github.io/Kanbaya/info/terms.html` |

Si utilizas otro dominio o ruta, sustituye la base por la dirección real de tu despliegue. A diferencia del origen OAuth, estos campos sí incluyen la ruta completa de cada página. Antes de guardar, abre los tres enlaces sin iniciar sesión y comprueba que son públicos y no devuelven un error 404.

Los textos están en inglés, como la web, y utilizan las incidencias públicas del repositorio como contacto. Revisa si necesitas añadir la identidad del responsable o un canal privado según tus obligaciones legales. No publiques datos confidenciales en las incidencias. Disponer de estas páginas no garantiza la aprobación de Google ni sustituye una revisión legal.

---

## 13. Qué no hace falta hacer para esta configuración básica

- Crear una máquina virtual o un servidor en Google.
- Mover Kanbaya desde GitHub Pages a Google Cloud.
- Crear una cuenta de servicio.
- Generar claves privadas.
- Solicitar acceso a todo Google Drive.
- Configurar Google Workspace Marketplace.
- Configurar “Abrir con” en la interfaz de Drive.
- Habilitar Google Picker API o crear una API key: esta integración lista los backups que crea Kanbaya. Una futura selección de otros archivos necesitaría su configuración específica.
- Publicar la aplicación OAuth antes de probar con tu cuenta.
- Introducir secretos en el repositorio.

---

## 14. Documentación oficial utilizada

Las instrucciones de Google pueden cambiar. Estas son las referencias para comprobar los nombres y requisitos actuales:

- [Crear el Client ID y configurar los orígenes JavaScript](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid).
- [Configurar la pantalla de consentimiento y los usuarios de prueba](https://developers.google.com/workspace/guides/configure-oauth-consent).
- [Permisos de Google Drive y alcance de drive.file](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
- [Habilitar Google Drive API](https://console.cloud.google.com/flows/enableapi?apiid=drive.googleapis.com).
- [Autorización desde el navegador mediante tokens](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

La configuración local del servidor se puede consultar en [app/tests/server.js](app/tests/server.js). El funcionamiento y despliegue de Kanbaya están descritos en el [README](README.md).
