use serde::{Deserialize, Serialize};
use rust_decimal::Decimal;

use crate::error::AppResult;

// ─── NIF / País (Anexo II, Orden HAP/1650/2015) ───────────────────────────────
//
// Regla estricta: si los 2 primeros caracteres son LETRAS, se interpreta como
// prefijo de país (p.ej. "ESB12345645" → país=ES, NIF=B12345645).
// En caso contrario el código completo equivale al NIF y el país es España (ESP).

pub struct ParsedNif {
    /// Código ISO 3166-1 alpha-3 (ej. "ESP", "FRA")
    pub country_code: String,
    /// Número de identificación fiscal sin prefijo de país
    pub nif: String,
}

pub fn parse_nif_country(raw: &str) -> ParsedNif {
    let raw = raw.trim();
    if raw.len() > 2 {
        let first_two: String = raw.chars().take(2).collect();
        if first_two.chars().all(|c| c.is_ascii_alphabetic()) {
            let alpha3 = iso2_to_iso3(&first_two.to_uppercase());
            return ParsedNif {
                country_code: alpha3,
                nif: raw.chars().skip(2).collect(),
            };
        }
    }
    ParsedNif {
        country_code: "ESP".to_string(),
        nif: raw.to_string(),
    }
}

fn iso2_to_iso3(alpha2: &str) -> String {
    match alpha2 {
        "ES" => "ESP",
        "FR" => "FRA",
        "DE" => "DEU",
        "IT" => "ITA",
        "PT" => "PRT",
        "GB" => "GBR",
        "US" => "USA",
        "MX" => "MEX",
        "AR" => "ARG",
        "BR" => "BRA",
        _ => alpha2,
    }
    .to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Batch {
    #[serde(rename = "BatchIdentifier")]
    pub batch_identifier: String,
    #[serde(rename = "InvoicesCount")]
    pub invoices_count: u32,
    #[serde(rename = "TotalInvoicesAmount")]
    pub total_invoices_amount: Decimal,
    #[serde(rename = "TotalOutstandingAmount")]
    pub total_outstanding_amount: Decimal,
    #[serde(rename = "TotalExecutableAmount")]
    pub total_executable_amount: Decimal,
    #[serde(rename = "InvoiceCurrencyCode")]
    pub invoice_currency_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileHeader {
    #[serde(rename = "SchemaVersion")]
    pub schema_version: String,
    #[serde(rename = "Modality")]
    pub modality: String,
    #[serde(rename = "InvoiceIssuerType")]
    pub invoice_issuer_type: String,
    #[serde(rename = "Batch")]
    pub batch: Batch,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddressInSpain {
    #[serde(rename = "Address")]
    pub address: String,
    #[serde(rename = "PostCode")]
    pub post_code: String,
    #[serde(rename = "Town")]
    pub town: String,
    #[serde(rename = "Province")]
    pub province: String,
    #[serde(rename = "CountryCode")]
    pub country_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaxIdentification {
    #[serde(rename = "PersonTypeCode")]
    pub person_type_code: String,
    #[serde(rename = "ResidenceTypeCode")]
    pub residence_type_code: String,
    #[serde(rename = "TaxIdentificationNumber")]
    pub tax_identification_number: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegalEntity {
    #[serde(rename = "CorporateName")]
    pub corporate_name: String,
    #[serde(rename = "AddressInSpain", skip_serializing_if = "Option::is_none")]
    pub address_in_spain: Option<AddressInSpain>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Individual {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "FirstSurname")]
    pub first_surname: String,
    #[serde(rename = "SecondSurname", skip_serializing_if = "Option::is_none")]
    pub second_surname: Option<String>,
    #[serde(rename = "AddressInSpain", skip_serializing_if = "Option::is_none")]
    pub address_in_spain: Option<AddressInSpain>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdministrativeCentre {
    #[serde(rename = "CentreCode")]
    pub centre_code: String,
    #[serde(rename = "RoleTypeCode")]
    pub role_type_code: String,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "AddressInSpain", skip_serializing_if = "Option::is_none")]
    pub address_in_spain: Option<AddressInSpain>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdministrativeCentres {
    #[serde(rename = "AdministrativeCentre")]
    pub administrative_centre: Vec<AdministrativeCentre>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Party {
    #[serde(rename = "TaxIdentification")]
    pub tax_identification: TaxIdentification,
    #[serde(rename = "AdministrativeCentres", skip_serializing_if = "Option::is_none")]
    pub administrative_centres: Option<AdministrativeCentres>,
    #[serde(rename = "LegalEntity", skip_serializing_if = "Option::is_none")]
    pub legal_entity: Option<LegalEntity>,
    #[serde(rename = "Individual", skip_serializing_if = "Option::is_none")]
    pub individual: Option<Individual>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Parties {
    #[serde(rename = "SellerParty")]
    pub seller_party: Party,
    #[serde(rename = "BuyerParty")]
    pub buyer_party: Party,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaxAmount {
    #[serde(rename = "TotalAmount")]
    pub total_amount: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tax {
    #[serde(rename = "TaxTypeCode")]
    pub tax_type_code: String,
    #[serde(rename = "TaxRate")]
    pub tax_rate: Decimal,
    #[serde(rename = "TaxableBase")]
    pub taxable_base: TaxAmount,
    #[serde(rename = "TaxAmount")]
    pub tax_amount: TaxAmount,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaxesOutputs {
    #[serde(rename = "Tax")]
    pub tax: Vec<Tax>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaxWithheld {
    #[serde(rename = "TaxTypeCode")]
    pub tax_type_code: String,
    #[serde(rename = "TaxRate")]
    pub tax_rate: Decimal,
    #[serde(rename = "TaxableBase")]
    pub taxable_base: TaxAmount,
    #[serde(rename = "TaxAmount")]
    pub tax_amount: TaxAmount,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaxesWithheld {
    #[serde(rename = "Tax")]
    pub tax: Vec<TaxWithheld>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoiceTotals {
    #[serde(rename = "TotalGrossAmount")]
    pub total_gross_amount: Decimal,
    #[serde(rename = "TotalGrossAmountBeforeTaxes")]
    pub total_gross_amount_before_taxes: Decimal,
    #[serde(rename = "TotalTaxOutputs")]
    pub total_tax_outputs: Decimal,
    #[serde(rename = "TotalTaxesWithheld")]
    pub total_taxes_withheld: Decimal,
    #[serde(rename = "InvoiceTotal")]
    pub invoice_total: Decimal,
    #[serde(rename = "TotalOutstandingAmount")]
    pub total_outstanding_amount: Decimal,
    #[serde(rename = "TotalExecutableAmount")]
    pub total_executable_amount: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoiceLine {
    #[serde(rename = "ItemDescription")]
    pub item_description: String,
    #[serde(rename = "Quantity")]
    pub quantity: Decimal,
    #[serde(rename = "UnitPriceWithoutTax")]
    pub unit_price_without_tax: Decimal,
    #[serde(rename = "TotalCost")]
    pub total_cost: Decimal,
    #[serde(rename = "GrossAmount")]
    pub gross_amount: Decimal,
    #[serde(rename = "TaxesOutputs")]
    pub taxes_outputs: TaxesOutputs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Items {
    #[serde(rename = "InvoiceLine")]
    pub invoice_line: Vec<InvoiceLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaxPeriod {
    #[serde(rename = "StartDate")]
    pub start_date: String,
    #[serde(rename = "EndDate")]
    pub end_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Corrective {
    #[serde(rename = "InvoiceNumber", skip_serializing_if = "Option::is_none")]
    pub invoice_number: Option<String>,
    #[serde(rename = "InvoiceSeriesCode", skip_serializing_if = "Option::is_none")]
    pub invoice_series_code: Option<String>,
    #[serde(rename = "ReasonCode")]
    pub reason_code: String,
    #[serde(rename = "ReasonDescription")]
    pub reason_description: String,
    #[serde(rename = "TaxPeriod")]
    pub tax_period: TaxPeriod,
    #[serde(rename = "CorrectionMethod")]
    pub correction_method: String,
    #[serde(rename = "CorrectionMethodDescription")]
    pub correction_method_description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoiceHeader {
    #[serde(rename = "InvoiceNumber")]
    pub invoice_number: String,
    #[serde(rename = "InvoiceSeriesCode")]
    pub invoice_series_code: String,
    #[serde(rename = "InvoiceDocumentType")]
    pub invoice_document_type: String,
    #[serde(rename = "InvoiceClass")]
    pub invoice_class: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoiceIssueData {
    #[serde(rename = "IssueDate")]
    pub issue_date: String,
    #[serde(rename = "OperationDate")]
    pub operation_date: String,
    #[serde(rename = "InvoiceCurrencyCode")]
    pub invoice_currency_code: String,
    #[serde(rename = "TaxCurrencyCode")]
    pub tax_currency_code: String,
    #[serde(rename = "LanguageName")]
    pub language_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invoice {
    #[serde(rename = "InvoiceHeader")]
    pub invoice_header: InvoiceHeader,
    #[serde(rename = "InvoiceIssueData")]
    pub invoice_issue_data: InvoiceIssueData,
    #[serde(rename = "Corrective", skip_serializing_if = "Option::is_none")]
    pub corrective: Option<Corrective>,
    #[serde(rename = "TaxesOutputs")]
    pub taxes_outputs: TaxesOutputs,
    #[serde(rename = "TaxesWithheld", skip_serializing_if = "Option::is_none")]
    pub taxes_withheld: Option<TaxesWithheld>,
    #[serde(rename = "InvoiceTotals")]
    pub invoice_totals: InvoiceTotals,
    #[serde(rename = "Items")]
    pub items: Items,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invoices {
    #[serde(rename = "Invoice")]
    pub invoice: Vec<Invoice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename = "Facturae")]
pub struct FacturaeDocument {
    #[serde(rename = "FileHeader")]
    pub file_header: FileHeader,
    #[serde(rename = "Parties")]
    pub parties: Parties,
    #[serde(rename = "Invoices")]
    pub invoices: Invoices,
}

pub fn facturae_to_xml(document: &FacturaeDocument) -> AppResult<String> {
    let body = quick_xml::se::to_string(document)?;
    let ns_open = r#"<fe:Facturae xmlns:fe="http://www.facturae.es/Facturae/2014/v3.2.2/Facturae" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">"#;
    let body = body
        .replacen("<Facturae>", ns_open, 1)
        .replace("</Facturae>", "</fe:Facturae>");
    Ok(format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>{body}"))
}

pub fn reason_description_for(code: &str) -> &'static str {
    match code {
        "01" => "Número de factura",
        "02" => "Fecha de expedición",
        "03" => "Nombre y apellidos/Razón social",
        "04" => "Número de identificación fiscal",
        "05" => "Domicilio",
        "06" => "Datos del destinatario",
        "07" => "Cuota impositiva",
        "08" => "Tipo impositivo",
        "09" => "Operación exenta",
        "10" => "Inversión del sujeto pasivo",
        "14" => "Otras causas",
        _ => "Rectificación",
    }
}

pub fn correction_method_for(tipo_rect: &str) -> &'static str {
    match tipo_rect {
        "01" | "02" => "01",
        "03" => "03",
        "04" => "04",
        _ => "01",
    }
}

pub fn correction_method_description_for(tipo_rect: &str) -> &'static str {
    match tipo_rect {
        "01" | "02" => "Rectificación íntegra",
        "03" => "Rectificación por descuento global",
        "04" => "Autorización de la Agencia Tributaria",
        _ => "Rectificación íntegra",
    }
}
