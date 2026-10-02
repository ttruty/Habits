-- Design system (design/DESIGN_SYSTEM.md): habit colours use the palette keys and icons use icon
-- keys, not emoji. Same mapping as src/data/normalize.ts, which also covers anything missed here.
update public.habits set color = case color
  when 'purple' then 'violet'
  when 'red' then 'coral'
  when 'teal' then 'green'
  else color
end;

update public.habits set icon = case icon
  when '🏋️' then 'dumbbell' when '🏋' then 'dumbbell' when '💪' then 'dumbbell'
  when '🧘' then 'mind' when '🎧' then 'listen' when '🏃' then 'run'
  when '👟' then 'walk' when '🚶' then 'walk' when '🦵' then 'walk' when '🦶' then 'walk' when '📖' then 'book' when '📚' then 'book'
  when '🚴' then 'bike' when '🔥' then 'flame' when '🏊' then 'swim' when '🎮' then 'game'
  when '💧' then 'drop' when '😴' then 'sleep' when '✍️' then 'write' when '🎵' then 'music'
  else icon
end;

update public.habits set color = 'blue'
  where color not in ('blue', 'violet', 'orange', 'coral', 'green', 'amber');
