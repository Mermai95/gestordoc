import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument } from 'pdf-lib'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PROMPT = `Eres un experto contable español especializado en lectura de facturas para gestorías.
Tu tarea es extraer datos fiscales con máxima precisión.

INSTRUCCIONES CRÍTICAS:
1. Lee TODOS los tipos de IVA que aparezcan en la factura — nunca asumas solo 21%.
2. Los tipos válidos en España son: 0%, 4%, 5%, 10%, 21%. Léelos directamente del documento.
3. Si hay MÚLTIPLES tipos de IVA, crea una línea por cada tipo.
4. La línea principal es la de mayor base imponible. El resto van en lineas_extra.
5. Si es ABONO o RECTIFICATIVA (importes negativos, dice "abono", "nota de crédito", "rectificativa"), pon tipo "abono" e importes en negativo.
6. El campo "deducible" = igual que "cuota_iva" salvo que indique explícitamente que no es deducible.
7. Si la página está en blanco o no es una factura, responde: {"es_factura": false}
8. Si ves que la factura indica "Página X de Y" o "Pág. X/Y" o similar, incluye en "notas": "Página X de Y — puede necesitar unirse con otras páginas".
9. Si no ves claramente una fecha, deja el campo como string vacío "", NUNCA escribas texto como "sin fecha visible", "ilegible", "no visible" o similar en campos de fecha.

FORMATOS ESPECIALES DE IVA:
- Makro usa códigos: 1=10%, 2=21%, 3=21%, 5=4% — tradúcelos al porcentaje real.
- Algunas facturas ponen "IVA Reducido", "IVA Superreducido" — tradúcelos a 10% y 4%.
- Si ves "Exento" o "Exenta" → 0%.
- Si ves "RE" o "Recargo de equivalencia" → es un tipo separado, inclúyelo en lineas_extra.

NÚMERO DE FACTURA:
- Cópialo exactamente como aparece, con guiones, barras y letras.
- Si no aparece claramente, pon lo más parecido que veas.

NIF DEL EXPEDIDOR — REGLA CRÍTICA:
- El nif_expedidor es SIEMPRE el NIF/CIF del EMISOR de la factura (el proveedor que cobra).
- Búscalo en el bloque SUPERIOR de la factura: nombre del proveedor + dirección + razón social.
- NUNCA uses el NIF que aparezca en campos como "Datos del receptor", "Cliente", "Número NIF de cliente", "Razón social del cliente", o cualquier bloque inferior.
- Si ves dos NIFs en la factura, el del EMISOR es el que está en la cabecera junto al nombre del proveedor. El otro es del receptor — ignóralo para este campo.
- Si no podés determinar con certeza cuál es el del emisor, pon confianza "baja" y explícalo en notas.

RESPONDE SOLO CON ESTE JSON (sin texto, sin backticks):
{
  "num_factura": "número exacto",
  "fecha_expedicion": "DD/MM/YYYY",
  "fecha_operacion": "DD/MM/YYYY o vacío",
  "concepto": "Su fra. nº [num_factura] — [nombre expedidor corto]",
  "nif_expedidor": "NIF o CIF sin espacios",
  "expedidor": "nombre completo del emisor",
  "tipo": "factura o abono",
  "base_imponible": 0.00,
  "pct_iva": "21,0",
  "cuota_iva": 0.00,
  "deducible": 0.00,
  "confianza": "alta|media|baja",
  "notas": "observaciones relevantes o vacío",
  "lineas_extra": [
    { "base_imponible": 0.00, "pct_iva": "10,0", "cuota_iva": 0.00, "deducible": 0.00 }
  ]
}

EJEMPLO REAL — Makro con 3 tipos de IVA:
{
  "num_factura": "2500002982",
  "fecha_expedicion": "01/01/2025",
  "concepto": "Su fra. nº 2500002982 — MAKRO",
  "nif_expedidor": "A28206493",
  "expedidor": "MAKRO AUTOSERVICIO MAYORISTA SA",
  "tipo": "factura",
  "base_imponible": 214.16,
  "pct_iva": "21,0",
  "cuota_iva": 44.97,
  "deducible": 44.97,
  "confianza": "alta",
  "notas": "",
  "lineas_extra": [
    { "base_imponible": 8.24, "pct_iva": "10,0", "cuota_iva": 0.82, "deducible": 0.82 },
    { "base_imponible": 1.49, "pct_iva": "4,0",  "cuota_iva": 0.06, "deducible": 0.06 }
  ]
}

EJEMPLO — Factura abono/rectificativa:
{
  "num_factura": "AB-2025-001",
  "tipo": "abono",
  "base_imponible": -150.00,
  "pct_iva": "21,0",
  "cuota_iva": -31.50,
  "deducible": -31.50,
  "confianza": "alta",
  "lineas_extra": []
}`

// Llama a Claude Haiku con una página individual
async function procesarPagina(base64: string, mediaType: string, anthropicKey: string): Promise<any> {
  const isPdf = mediaType === 'application/pdf'
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          {
            type: isPdf ? 'document' : 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
  })
  const data = await response.json()
  const texto = data.content?.map((i: any) => i.text || '').join('') || ''
  const limpio = texto.replace(/```json|```/g, '').trim()
  return JSON.parse(limpio)
}

// AGENTE: valida que el NIF leído no sea el del propio cliente receptor
async function validarNifExpedidor(
  supabaseAdmin: any,
  nifLeido: string,
  clienteId: string | null
): Promise<{ valido: boolean; motivo: string }> {
  if (!nifLeido || !clienteId) return { valido: true, motivo: '' }

  const { data: cliente } = await supabaseAdmin
    .from('clientes')
    .select('nif_cif, nombre')
    .eq('id', clienteId)
    .single()

  if (!cliente) return { valido: true, motivo: '' }

  const nifCliente = cliente.nif_cif?.replace(/\s/g, '').toUpperCase()
  const nifFactura = nifLeido?.replace(/\s/g, '').toUpperCase()

  if (nifCliente && nifFactura && nifCliente === nifFactura) {
    return {
      valido: false,
      motivo: `NIF leído (${nifLeido}) coincide con el cliente receptor (${cliente.nombre}) — probable error de lectura`
    }
  }

  return { valido: true, motivo: '' }
}

// Sube un PDF a Supabase Storage y devuelve la ruta
async function subirStorage(supabaseAdmin: any, bytes: Uint8Array, nombre: string): Promise<string | null> {
  try {
    const ruta = `email/${nombre}`
    const { error } = await supabaseAdmin.storage
      .from('facturas')
      .upload(ruta, bytes, { contentType: 'application/pdf', upsert: false })
    if (error) { console.error('Error storage:', error); return null }
    return ruta
  } catch (e) {
    console.error('Error storage:', e)
    return null
  }
}

// Procesa UNA página completa: extraer + subir a storage + IA. Nunca lanza error hacia afuera.
async function procesarUnaPagina(
  pdfDoc: any,
  indice: number,
  numPages: number,
  timestamp: number,
  supabaseAdmin: any,
  anthropicKey: string,
  clienteId: string | null = null
): Promise<any | null> {
  try {
    const paginaDoc = await PDFDocument.create()
    const [pagina] = await paginaDoc.copyPages(pdfDoc, [indice])
    paginaDoc.addPage(pagina)
    const paginaBytes = await paginaDoc.save()

    const nombreArchivo = `${timestamp}_p${indice + 1}_of_${numPages}.pdf`
    const archivoUrl = await subirStorage(supabaseAdmin, paginaBytes, nombreArchivo)

    const binary = paginaBytes.reduce((acc, b) => acc + String.fromCharCode(b), '')
    const base64 = btoa(binary)

    const parsed = await procesarPagina(base64, 'application/pdf', anthropicKey)

    if (parsed?.es_factura === false) return null

    if (numPages > 1 && parsed.notas !== undefined) {
      const notaPagina = `Página ${indice + 1} de ${numPages}`
      parsed.notas = parsed.notas
        ? `${notaPagina} — ${parsed.notas}`
        : notaPagina
    }

    if (archivoUrl) parsed.archivo_url = archivoUrl

    // AGENTE: validar NIF expedidor vs cliente receptor
   const validacionNif = await validarNifExpedidor(supabaseAdmin, parsed.nif_expedidor, clienteId)

    if (!validacionNif.valido) {
      parsed.estado = 'revisar'
      parsed.motivo_revision = validacionNif.motivo
      parsed.confianza = 'baja'
      parsed.nif_expedidor = ''
      return parsed
    }

    // AGENTE: decidir estado según confianza
    if (parsed.confianza === 'alta') {
      parsed.estado = 'procesada'
    } else if (parsed.confianza === 'media') {
      parsed.estado = 'revisar'
      parsed.motivo_revision = 'Confianza media — revisar datos extraídos'
    } else {
      parsed.estado = 'revisar'
      parsed.motivo_revision = 'Confianza baja — ' + (parsed.notas || 'verificar manualmente')
    }

    return parsed

  } catch (err) {
    console.error(`Error en página ${indice + 1}:`, err)
    return null
  }
}

// ── NUEVO: junta las partes subidas a Storage y reconstruye el PDF completo ──
async function juntarPartes(supabaseAdmin: any, idLote: string, totalPartes: number): Promise<Uint8Array> {
  let base64Completo = ''

  for (let i = 1; i <= totalPartes; i++) {
    const ruta = `temp/${idLote}_parte${i}.txt`
    const { data, error } = await supabaseAdmin.storage
      .from('facturas')
      .download(ruta)

    if (error) throw new Error(`No se pudo descargar la parte ${i}: ${error.message}`)

    const texto = await data.text()
    base64Completo += texto
  }

  // Limpieza: borrar las partes temporales una vez juntadas (no son necesarias después)
  const rutasABorrar = []
  for (let i = 1; i <= totalPartes; i++) {
    rutasABorrar.push(`temp/${idLote}_parte${i}.txt`)
  }
  await supabaseAdmin.storage.from('facturas').remove(rutasABorrar)

  const binaryStr = atob(base64Completo)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }
  return bytes
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY no configurada')

    const contentType = req.headers.get('content-type') || ''
    let pdfBytes: Uint8Array
    let mediaType = 'application/pdf'
    let esMultipagina = false
    let clienteIdGlobal: string | null = null

    // ── Path n8n NUEVO: JSON con id_lote + total_partes (PDF ya subido en pedazos a Storage) ──
    if (contentType.includes('application/json')) {
      const body = await req.json()

      if (body.id_lote && body.total_partes) {
        // Flujo de lotes: juntar las partes que n8n subió previamente a Storage
        pdfBytes = await juntarPartes(supabaseAdmin, body.id_lote, body.total_partes)
        esMultipagina = true
        clienteIdGlobal = body.cliente_id || null

      } else if (body.pdf_base64) {
        // Compatibilidad con el flujo viejo (PDF chico, base64 directo en el JSON)
        const binaryStr = atob(body.pdf_base64)
        pdfBytes = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) {
          pdfBytes[i] = binaryStr.charCodeAt(i)
        }
        esMultipagina = true

      } else {
        return new Response(JSON.stringify({ error: 'Falta id_lote/total_partes o pdf_base64' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

    // ── Path manual frontend: multipart ──────────────────────────────────────
    } else {
      const formData = await req.formData()
      const archivo  = formData.get('archivo') as File
      if (!archivo) {
        return new Response(JSON.stringify({ error: 'No se recibió archivo' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const buffer = await archivo.arrayBuffer()
      pdfBytes  = new Uint8Array(buffer)
      mediaType = archivo.type
      esMultipagina = false
    }

    // ── Flujo MULTIPÁGINA (email): divide y procesa en lotes paralelos ────────
    if (esMultipagina) {
      const pdfDoc   = await PDFDocument.load(pdfBytes)
      const numPages = pdfDoc.getPageCount()
      const timestamp = Date.now()
      const resultados: any[] = []

      const TAMANO_LOTE = 15

      for (let inicio = 0; inicio < numPages; inicio += TAMANO_LOTE) {
        const fin = Math.min(inicio + TAMANO_LOTE, numPages)
        const indicesLote = []
        for (let i = inicio; i < fin; i++) indicesLote.push(i)

        const promesasLote = indicesLote.map((indice) =>
          procesarUnaPagina(pdfDoc, indice, numPages, timestamp, supabaseAdmin, anthropicKey, clienteIdGlobal)
        )
        const resultadosLote = await Promise.all(promesasLote)

        for (const parsed of resultadosLote) {
          if (parsed !== null) resultados.push(parsed)
        }
      }

      return new Response(JSON.stringify(resultados), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Flujo SIMPLE (frontend manual): una sola página ───────────────────────
    const binary = pdfBytes.reduce((acc, b) => acc + String.fromCharCode(b), '')
    const base64 = btoa(binary)
    const parsed = await procesarPagina(base64, mediaType, anthropicKey)

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})