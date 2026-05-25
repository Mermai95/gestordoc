import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

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
7. Si ves que la factura indica "Página X de Y" o "Pág. X/Y" o similar, incluye en "notas": "Página X de Y — puede necesitar unirse con otras páginas".

FORMATOS ESPECIALES DE IVA:
- Makro usa códigos: 1=10%, 2=21%, 3=21%, 5=4% — tradúcelos al porcentaje real.
- Algunas facturas ponen "IVA Reducido", "IVA Superreducido" — tradúcelos a 10% y 4%.
- Si ves "Exento" o "Exenta" → 0%.
- Si ves "RE" o "Recargo de equivalencia" → es un tipo separado, inclúyelo en lineas_extra.

NÚMERO DE FACTURA:
- Cópialo exactamente como aparece, con guiones, barras y letras.
- Si no aparece claramente, pon lo más parecido que veas.

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
Factura muestra: "8,24 1=10,00% 0,82 / 214,16 2=21,00% 44,97 / 1,49 5=4,00% 0,06"
Resultado:
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
    { "base_imponible": 8.24,  "pct_iva": "10,0", "cuota_iva": 0.82, "deducible": 0.82 },
    { "base_imponible": 1.49,  "pct_iva": "4,0",  "cuota_iva": 0.06, "deducible": 0.06 }
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
        model: 'claude-haiku-4-5-20251001',
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
