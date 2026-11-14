"use client";

import { t } from "@bsd/i18n";
import { useState } from "react";
import { inputClass } from "./field";
import { Icon } from "./icons";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  id: string;
};

/** Password box with an eye button that shows or hides what was typed. */
export function PasswordInput(props: Props) {
  const [visible, setVisible] = useState(false);
  const label = t(visible ? "auth.hidePassword" : "auth.showPassword");
  return (
    <div className="relative">
      <input {...props} type={visible ? "text" : "password"} className={`${inputClass} pr-11`} />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={label}
        aria-pressed={visible}
        aria-controls={props.id}
        title={label}
        className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-lg text-text-muted transition-colors hover:text-text"
      >
        <Icon name={visible ? "eyeOff" : "eye"} className="size-[18px]" />
      </button>
    </div>
  );
}
