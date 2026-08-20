"use client";
import { UserDetailContext } from "@/context/UserDetailContext";
import { supabase } from "@/services/supabaseClient";

import React, { useCallback, useContext, useEffect, useState } from "react";

/**
 * The PayPal script provider used to live here, which meant every visitor —
 * including an anonymous candidate taking an interview — downloaded and
 * executed a third-party payments SDK. It is now mounted by the billing page,
 * the only page that can spend money.
 */
function Provider({ children }) {
  const [user, setUser] = useState(null);

  const loadOrCreateUser = useCallback(async () => {
    const {
      data: { user: account },
    } = await supabase.auth.getUser();
    if (!account?.email) return;

    const { data: existing, error } = await supabase
      .from("Users")
      .select("*")
      .eq("email", account.email)
      .maybeSingle();

    if (error) {
      console.error("[provider] could not read the profile:", error.message);
      return;
    }
    if (existing) {
      setUser(existing);
      return;
    }

    // .insert() alone resolves with data: null, so this used to set the user to
    // null immediately after creating them — the app then behaved as though
    // nobody was signed in until the next reload. The row has to be selected
    // back. `credits` is not sent: the column is not writable by a browser, and
    // the database default is the starting balance.
    const { data: created, error: insertError } = await supabase
      .from("Users")
      .insert([
        {
          name: account.user_metadata?.name,
          email: account.email,
          picture: account.user_metadata?.picture,
        },
      ])
      .select()
      .single();

    if (insertError) {
      console.error("[provider] could not create the profile:", insertError.message);
      return;
    }
    setUser(created);
  }, []);

  useEffect(() => {
    loadOrCreateUser();
  }, [loadOrCreateUser]);

  return (
    <UserDetailContext.Provider value={{ user, setUser }}>
      <div>{children}</div>
    </UserDetailContext.Provider>
  );
}

export default Provider;

export const useUser = () => {
  const context = useContext(UserDetailContext);
  return context;
};
