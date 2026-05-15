# GestorDoc

App de lectura inteligente de facturas para gestorías contables.  
Lee facturas con IA, el contable valida, exporta en formato A3 ECO.

## Stack

- React + Vite
- Supabase (auth + base de datos + storage)
- SheetJS (exportación Excel A3)
- Vercel (deploy)

## Setup local

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env.local
# → Rellenar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY

# 3. Arrancar
npm run dev
```

## Estructura

```
src/
  pages/
    Login.jsx          → /login
    Clientes.jsx       → /clientes
    Facturas.jsx       → /clientes/:clienteId
  components/
    layout/
      AppLayout.jsx    → Navbar + contenedor principal
    ProtectedRoute.jsx → Redirección si no hay sesión
  hooks/
    useAuth.jsx        → Contexto de autenticación
  lib/
    supabase.js        → Cliente de Supabase
    exportarA3.js      → Exportación Excel formato A3 ECO
```

## Rutas

| Ruta | Acceso | Descripción |
|------|--------|-------------|
| `/login` | Público | Login con email + contraseña |
| `/clientes` | Privado | Lista de clientes del gestor |
| `/clientes/:id` | Privado | Facturas de un cliente |
