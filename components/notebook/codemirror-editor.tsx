"use client";
// components/notebook/codemirror-editor.tsx
//
// Direct CodeMirror 5 integration — bypasses react-codemirror2 to avoid
// React 18 strict mode issues (duplicate editors, broken input).
// This file is loaded via next/dynamic with ssr: false.

import { useRef, useEffect } from "react";
import CodeMirror from "codemirror";

import "codemirror/lib/codemirror.css";
import "codemirror/theme/material-darker.css";
import "codemirror/mode/python/python";

interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

export default function CodeMirrorEditor({
  value,
  onChange,
  readOnly = false,
}: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CodeMirror.Editor | null>(null);
  const onChangeRef = useRef(onChange);
  const isExternalUpdate = useRef(false);

  // Keep onChange ref fresh without recreating the editor
  onChangeRef.current = onChange;

  // Create editor on mount, destroy on unmount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = CodeMirror(container, {
      value,
      mode: "python",
      theme: "material-darker",
      lineNumbers: true,
      lineWrapping: true,
      readOnly: readOnly ? "nocursor" : false,
      tabSize: 4,
      indentUnit: 4,
      indentWithTabs: false,
      viewportMargin: Infinity,
      extraKeys: {
        Tab: (cm) => {
          if (cm.somethingSelected()) {
            cm.indentSelection("add");
          } else {
            cm.replaceSelection("    ", "end");
          }
        },
      },
    });

    editor.on("change", () => {
      if (isExternalUpdate.current) return;
      onChangeRef.current(editor.getValue());
    });

    editorRef.current = editor;

    // Force correct sizing after DOM paint
    requestAnimationFrame(() => editor.refresh());

    return () => {
      editorRef.current = null;
      // Remove the CodeMirror DOM element on cleanup
      const wrapper = editor.getWrapperElement();
      wrapper.parentNode?.removeChild(wrapper);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount once only

  // Sync external value changes (streaming code from AI)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.getValue() === value) return;
    isExternalUpdate.current = true;
    editor.setValue(value);
    editor.setCursor(editor.lineCount(), 0);
    isExternalUpdate.current = false;
  }, [value]);

  // Sync readOnly
  useEffect(() => {
    editorRef.current?.setOption("readOnly", readOnly ? "nocursor" : false);
  }, [readOnly]);

  return <div ref={containerRef} />;
}
