import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PROMPT = `Eres un experto en lectura de facturas españolas para gestorías contables.

Extrae los datos y responde SOLO con JSON, sin texto adicional ni backticks.

REGLAS IMPORTANTES:
1. Si la factura tiene MÚLTIPLES tipos de IVA (ej: productos al 21%, otros al 10%, otros al 4% o 0%), crea una línea principal con el importe mayor y el resto en lineas_extra. NUNCA mezcles importes de distintos IVAs en una sola línea.
2. Los tipos de IVA en España son: 21%, 10%, 5%, 4%, 0%. Léelos directamente de la factura, no asumas siempre 21%.
3. Si es una factura RECTIFICATIVA o ABONO (importe negativo, pone "abono", "rectificativa", "nota de crédito"), pon los importes en NEGATIVO y tipo "abono".
4. El campo "deducible" es igual a "cuota_iva" salvo que la factura indique explícitamente que no es deducible.
5. Si la página no contiene una factura (está en blanco o es portada), responde exactamente: {"es_factura": false}

FORMATO DE RESPUESTA:
{
  "num_factura": "número exacto de la factura",
  "fecha_expedicion": "DD/MM/YYYY",
  "fecha_operacion": "DD/MM/YYYY o vacío si no aparece",
  "concepto": "descripción breve del proveedor y tipo de compra",
  "nif_expedidor": "NIF o CIF del emisor",
  "expedidor": "nombre completo del emisor",
  "tipo": "factura o abono",
  "base_imponible": 0.00,
  "pct_iva": "21,0",
  "cuota_iva": 0.00,
  "deducible": 0.00,
  "confianza": "alta|media|baja",
  "notas": "cualquier observación relevante o vacío",
  "lineas_extra": []
}

lineas_extra — una entrada por cada tipo de IVA adicional:
[
  { "base_imponible": 0.00, "pct_iva": "10,0", "cuota_iva": 0.00, "deducible": 0.00 },
  { "base_imponible": 0.00, "pct_iva": "4,0",  "cuota_iva": 0.00, "deducible": 0.00 },
  { "base_imponible": 0.00, "pct_iva": "0",     "cuota_iva": 0.00, "deducible": 0.00 }
]

EJEMPLO Makro con 3 tipos de IVA:
- Línea principal: base 150.00, pct_iva "21,0", cuota 31.50
- lineas_extra: [
    { base_imponible: 80.00, pct_iva: "10,0", cuota_iva: 8.00, deducible: 8.00 },
    { base_imponible: 20.00, pct_iva: "4,0",  cuota_iva: 0.80, deducible: 0.80 }
  ]

Responde SOLO con el JSON.`

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const formData = await req.formData()
    const archivo  = formData.get('archivo') as File

    if (!archivo) {
      return new Response(JSON.stringify({ error: 'No se recibió archivo' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY no configurada')

    const buffer = await archivo.arrayBuffer()
    const bytes  = new Uint8Array(buffer)
    const binary = bytes.reduce((acc, b) => acc + String.fromCharCode(b), '')
    const base64 = btoa(binary)
    const isPdf  = archivo.type === 'application/pdf'

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            {
              type: isPdf ? 'document' : 'image',
              source: { type: 'base64', media_type: archivo.type, data: base64 },
            },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    })

    const data   = await response.json()
    const texto  = data.content?.map((i: any) => i.text || '').join('') || ''
    const limpio = texto.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(limpio)

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
