"use client";

import { useRef, useState } from "react";
import { CampIcon } from "../icons";
import { Modal } from "../Modal";
import { requestConfirm } from "../ConfirmDialog";
import {
  campDocumentUrl,
  createDocumentId,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_TOTAL_BYTES,
  type CampDocument,
} from "@/lib/campDocuments";

// Manage the downloadable camp documents — upload new files, rename, reorder,
// download, and delete — on the SAME surface as the camps/themes/locations
// manager (the shared Modal shell + `manager__*` vocabulary), so it reads as one
// standardized management screen. Uploaded files are read to a base64 data URL
// and stored inline in the synced `documents` doc; the built-in seed PDFs live
// beside them and edit identically.

// Read a File into a `data:` base64 URL (its bytes, inline) for the doc store.
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function DocumentsModal({
  documents,
  onChange,
  canEdit,
  announce,
  onClose,
}: {
  documents: CampDocument[];
  onChange: (updater: (prev: CampDocument[]) => CampDocument[]) => void;
  // Downloads are open to everyone; uploading, renaming, and deleting are
  // editor-only. Viewers get the same modal as a clean download list.
  canEdit: boolean;
  announce: (message: string) => void;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      // Build the additions first so the total-size guard sees the whole batch,
      // then commit once — a single synced write for the upload.
      const additions: CampDocument[] = [];
      for (const file of Array.from(files)) {
        if (file.size > MAX_DOCUMENT_BYTES) {
          announce(`“${file.name}” is too large — files must be under ${Math.round(MAX_DOCUMENT_BYTES / 1_000_000)} MB.`);
          continue;
        }
        const data = await readFileAsDataUrl(file);
        additions.push({
          id: createDocumentId(),
          name: file.name.replace(/\.[^.]+$/, ""),
          fileName: file.name,
          mime: file.type || "application/octet-stream",
          data,
        });
      }
      if (additions.length === 0) return;
      const next = [...documents, ...additions];
      // Keep the serialized doc under the synced-doc ceiling (base64 bytes are
      // the bulk). If it would overflow, reject the batch rather than silently
      // lose it to the server's size limit on the next sync.
      if (JSON.stringify(next).length > MAX_DOCUMENTS_TOTAL_BYTES) {
        announce("Not enough room — remove a document before adding more.");
        return;
      }
      onChange(() => next);
      announce(additions.length === 1 ? "Document added." : `${additions.length} documents added.`);
    } catch {
      announce("Could not read that file. Please try again.");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function commitRename(id: string) {
    const name = editDraft.trim();
    if (name) onChange((prev) => prev.map((doc) => (doc.id === id ? { ...doc, name } : doc)));
    setEditingId(null);
  }

  async function remove(doc: CampDocument) {
    const ok = await requestConfirm({
      title: `Delete “${doc.name}”?`,
      body: "This removes it from the download list. This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) onChange((prev) => prev.filter((d) => d.id !== doc.id));
  }

  return (
    <Modal label="Documents" onClose={onClose} overlayProps={{ className: "overlay--card overlay--manager" }}>
      <div className="overlay__bar">
        <h2 className="manager__title">Documents</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <CampIcon.Close />
        </button>
      </div>
      <div className="overlay__body manager manager--docs">
        <p className="manager__intro">
          {canEdit
            ? "Prepared files anyone can download from the Print tab. Upload your own, rename them, or remove ones you don’t need."
            : "Prepared files for this camp — click one to download."}
        </p>

        {canEdit && (
          <div className="manager__create">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => addFiles(e.target.files)}
            />
            <button
              type="button"
              className="btn btn--primary manager__createbtn"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <CampIcon.Plus />
              {busy ? "Adding…" : "Upload file"}
            </button>
          </div>
        )}

        {documents.length === 0 ? (
          <p className="manager__empty">{canEdit ? "No documents yet — upload one to get started." : "No documents yet."}</p>
        ) : (
          <ul className="manager__list">
            {documents.map((doc) => {
              const isEditing = canEdit && editingId === doc.id;
              return (
                <li key={doc.id} className="manager__row">
                  {isEditing ? (
                    <form
                      className="manager__rowedit"
                      onSubmit={(e) => {
                        e.preventDefault();
                        commitRename(doc.id);
                      }}
                    >
                      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                      <input
                        className="input manager__editinput"
                        value={editDraft}
                        autoFocus
                        aria-label={"Rename " + doc.name}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onBlur={() => commitRename(doc.id)}
                      />
                      <button type="submit" className="icon-btn manager__rowbtn" aria-label="Save name">
                        <CampIcon.Check />
                      </button>
                    </form>
                  ) : (
                    <div className="manager__rowmain">
                      <a
                        className="manager__pick"
                        href={campDocumentUrl(doc)}
                        download={doc.fileName}
                        title={"Download " + doc.name}
                      >
                        <span className="manager__docicon" aria-hidden="true">
                          <CampIcon.Card />
                        </span>
                        <span className="manager__label">{doc.name}</span>
                      </a>
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            className="icon-btn manager__rowbtn"
                            aria-label={"Rename " + doc.name}
                            onClick={() => {
                              setEditingId(doc.id);
                              setEditDraft(doc.name);
                            }}
                          >
                            <CampIcon.Pencil />
                          </button>
                          <button
                            type="button"
                            className="icon-btn manager__rowbtn manager__rowbtn--danger"
                            aria-label={"Delete " + doc.name}
                            onClick={() => remove(doc)}
                          >
                            <CampIcon.Trash />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
