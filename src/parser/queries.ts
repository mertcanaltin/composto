import type { Language } from "./languages.js";

const TYPESCRIPT_QUERIES = {
  functions: "(function_declaration name: (identifier) @name) @fn",
  exports: "(export_statement) @export",
  classes: `[
    (class_declaration name: (type_identifier) @name) @class
    (interface_declaration name: (type_identifier) @name) @interface
  ]`,
  imports: "(import_statement) @import",
  control: `[
    (if_statement) @if
    (for_statement) @for
    (for_in_statement) @for_in
    (while_statement) @while
    (return_statement) @return
    (try_statement) @try
  ]`,
};

const JAVASCRIPT_QUERIES = {
  functions: "(function_declaration name: (identifier) @name) @fn",
  exports: "(export_statement) @export",
  classes: "(class_declaration name: (identifier) @name) @class",
  imports: "(import_statement) @import",
  control: `[
    (if_statement) @if
    (for_statement) @for
    (for_in_statement) @for_in
    (while_statement) @while
    (return_statement) @return
    (try_statement) @try
  ]`,
};

const PYTHON_QUERIES = {
  functions: "(function_definition name: (identifier) @name) @fn",
  exports: "",
  classes: "(class_definition name: (identifier) @name) @class",
  imports: `[
    (import_statement) @import
    (import_from_statement) @import
  ]`,
  control: `[
    (if_statement) @if
    (for_statement) @for
    (while_statement) @while
    (return_statement) @return
    (try_statement) @try
  ]`,
};

const GO_QUERIES = {
  functions: `[
    (function_declaration name: (identifier) @name) @fn
    (method_declaration name: (field_identifier) @name) @fn
  ]`,
  exports: "",
  classes: "(type_declaration (type_spec name: (type_identifier) @name)) @type",
  imports: "(import_declaration) @import",
  control: `[
    (if_statement) @if
    (for_statement) @for
    (return_statement) @return
  ]`,
};

const RUST_QUERIES = {
  functions: "(function_item name: (identifier) @name) @fn",
  exports: "",
  classes: `[
    (struct_item name: (type_identifier) @name) @struct
    (enum_item name: (type_identifier) @name) @enum
    (trait_item name: (type_identifier) @name) @trait
    (impl_item type: (type_identifier) @name) @impl
  ]`,
  imports: "(use_declaration) @import",
  control: `[
    (if_expression) @if
    (for_expression) @for
    (loop_expression) @loop
    (match_expression) @match
    (return_expression) @return
  ]`,
};

export type QuerySet = {
  functions: string;
  exports: string;
  classes: string;
  imports: string;
  control: string;
};

const QUERY_MAP: Record<Language, QuerySet> = {
  typescript: TYPESCRIPT_QUERIES,
  javascript: JAVASCRIPT_QUERIES,
  python: PYTHON_QUERIES,
  go: GO_QUERIES,
  rust: RUST_QUERIES,
};

export function getQueries(lang: Language): QuerySet {
  return QUERY_MAP[lang];
}
