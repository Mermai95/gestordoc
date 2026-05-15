import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verificar que el usuario está autenticado
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Leer el archivo enviado
    const formData  = await req.formData()
    const archivo   = formData.get('archivo') as File
    if (!archivo) {
      return new Response(JSON.stringify({ error: 'No se recibió archivo' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Convertir a base64
    const buffer    = await archivo.arrayBuffer()
    const bytes     = new Uint8Array(buffer)
    const binary    = bytes.reduce((acc, b) => acc + String.fromCharCode(b), '')
    const base64    = btoa(binary)
    const isPdf     = archivo.type === 'application/pdf'

    // Llamar a Anthropic — la key queda en el servidor, nunca en el navegador
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY no configurada')

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: isPdf ? 'document' : 'image',
              source: { type: 'base64', media_type: archivo.type, data: base64 },
            },
            {
              type: 'text',
              text: `Eres un experto en lectura de facturas españolas.
Extrae los datos y responde SOLO con JSON, sin texto adicional ni backticks:

{
  "num_factura": "número de factura",
  "fecha_expedicion": "DD/MM/YYYY",
  "fecha_operacion": "DD/MM/YYYY o vacío",
  "concepto": "descripción de la factura",
  "nif_expedidor": "NIF o CIF del emisor",
  "expedidor": "nombre del emisor",
  "base_imponible": 0.00,
  "pct_iva": "21,0",
  "cuota_iva": 0.00,
  "deducible": 0.00,
  "confianza": "alta|media|baja",
  "notas": "observaciones o vacío",
  "lineas_extra": []
}

lineas_extra es un array para cuando hay múltiples tipos de IVA:
[{ "base_imponible": 0.00, "pct_iva": "0", "cuota_iva": 0, "deducible": 0 }]

Si un campo no aparece usa "" o 0. Responde SOLO con el JSON.`,
            },
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